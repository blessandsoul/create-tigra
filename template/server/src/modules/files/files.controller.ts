/**
 * Files Controller
 *
 * Auth-gated, owner-scoped streaming of PRIVATE-tier files.
 *
 * SECURITY model — three independent guards, any one of which forces a 404
 * (never a 403: we do not leak whether a file exists):
 *   1. Owner-scoped by construction. The on-disk path is built from the
 *      AUTHENTICATED user's id (request.user.userId), never a client-supplied
 *      owner. A user can therefore only ever read files under their OWN private
 *      directory — there is no parameter that selects another user's files.
 *   2. Filename validation. The :filename segment is rejected if it contains a
 *      path separator, a `..` traversal, or a null byte.
 *   3. Path containment. After path.resolve, the absolute target must still sit
 *      inside the user's resolved private directory — a final belt-and-braces
 *      check against any traversal the validation missed.
 *
 * NOTE for apps with a Prisma file/upload model: swap the path-based
 * owner-scoping below for a DB lookup keyed on ownerId — load the row by id,
 * 404 if it doesn't exist OR its ownerId !== request.user.userId, then stream
 * from the stored path. The Range/streaming half of this handler stays the same.
 */

import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyReply } from 'fastify';
import { fileStorageService } from '@libs/storage/file-storage.service.js';
import { NotFoundError } from '@shared/errors/errors.js';
import type { AuthenticatedRequest } from '@shared/types/index.js';
import { logger } from '@libs/logger.js';

/** Map a file extension to a Content-Type. Falls back to octet-stream. */
const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
};

function contentTypeFor(filename: string): string {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

/** Reject any filename that is not a single safe path segment. */
function isUnsafeFilename(filename: string): boolean {
  return (
    !filename ||
    filename.includes('\0') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..')
  );
}

/**
 * Parse a single `bytes=start-end` Range header against a known total size.
 * Returns null when there is no (usable) range and the full file should be
 * sent, or an `unsatisfiable` marker when the range is out of bounds (→ 416).
 */
function parseRange(
  rangeHeader: string | undefined,
  size: number,
): { start: number; end: number } | null | 'unsatisfiable' {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null; // unparseable → ignore, serve full body (RFC 7233)

  const [, startRaw, endRaw] = match;
  if (startRaw === '' && endRaw === '') return null;

  let start: number;
  let end: number;
  if (startRaw === '') {
    // Suffix range: last N bytes.
    const suffix = Number(endRaw);
    if (suffix <= 0) return 'unsatisfiable';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Number(endRaw);
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    return 'unsatisfiable';
  }
  if (end >= size) end = size - 1;
  return { start, end };
}

class FilesController {
  /**
   * GET /api/v1/files/:filename
   *
   * Streams a PRIVATE file owned by the authenticated user. Honors a Range
   * header (206 partial content); otherwise sends the full file (200).
   */
  async getPrivateFile(
    request: AuthenticatedRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.user.userId;
    const { filename } = request.params as { filename: string };

    // Guard 2: filename validation. Any violation → 404 (no existence leak).
    if (isUnsafeFilename(filename)) {
      logger.warn({ msg: 'Rejected unsafe private file name', userId, filename });
      throw new NotFoundError('File not found', 'FILE_NOT_FOUND');
    }

    // Guard 1: owner-scoped path, derived from the authenticated user id only.
    const filePath = fileStorageService.getPrivateFilePath(userId, filename);

    // Guard 3: path containment. The resolved absolute path must remain inside
    // the user's resolved private directory.
    const userPrivateRoot = path.resolve(
      fileStorageService.getPrivateDir(),
      'users',
      userId,
    );
    const resolved = path.resolve(filePath);
    if (resolved !== userPrivateRoot && !resolved.startsWith(userPrivateRoot + path.sep)) {
      logger.warn({ msg: 'Private file path escaped owner root', userId, filename });
      throw new NotFoundError('File not found', 'FILE_NOT_FOUND');
    }

    // Stat the file — missing/inaccessible/dir → 404 (no existence leak).
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch {
      throw new NotFoundError('File not found', 'FILE_NOT_FOUND');
    }
    if (!stat.isFile()) {
      throw new NotFoundError('File not found', 'FILE_NOT_FOUND');
    }

    const size = stat.size;
    const contentType = contentTypeFor(filename);

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', contentType);
    // Private files must never be cached by shared/proxy caches.
    reply.header('Cache-Control', 'private');

    const range = parseRange(request.headers.range, size);

    if (range === 'unsatisfiable') {
      reply.header('Content-Range', `bytes */${size}`);
      reply.code(416);
      return reply.send('Range Not Satisfiable');
    }

    if (range) {
      const { start, end } = range;
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
      reply.header('Content-Length', String(end - start + 1));
      return reply.send(createReadStream(resolved, { start, end }));
    }

    // No range → full file.
    reply.code(200);
    reply.header('Content-Length', String(size));
    return reply.send(createReadStream(resolved));
  }
}

export const filesController = new FilesController();
