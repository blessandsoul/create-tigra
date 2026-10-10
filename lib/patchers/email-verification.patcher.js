/**
 * Email Verification Module Patcher
 *
 * Uses ts-morph to structurally transform TypeScript files in a generated project.
 * This approach is resilient to formatting changes and works on existing projects
 * where developers may have modified the template code.
 */

import { Project, SyntaxKind } from 'ts-morph';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..', '..');
const MODULES_DIR = path.join(ROOT_DIR, 'modules', 'email-verification');

/**
 * Apply the email verification module to a generated project.
 * Copies module files and patches existing files via ts-morph AST transforms.
 *
 * @param {string} targetDir - Path to the generated project root
 */
export async function applyEmailVerificationModule(targetDir) {
  // A) Copy module files
  await copyModuleFiles(targetDir);

  // B) Patch server files via ts-morph
  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
  });

  patchAuthRoutes(project, targetDir);
  patchAuthSchemas(project, targetDir);
  patchRateLimitConfig(project, targetDir);
  patchAuthService(project, targetDir);
  patchAuthRepo(project, targetDir);

  // C) Patch client files via ts-morph
  patchApiEndpoints(project, targetDir);
  patchErrorCodes(project, targetDir);
  patchUseAuthHook(targetDir);

  // D) Patch Postman collection (JSON, not ts-morph)
  await patchPostmanCollection(targetDir);
}

// ─── File Copy ──────────────────────────────────────────────────

async function copyModuleFiles(targetDir) {
  const copies = [
    {
      src: path.join(MODULES_DIR, 'server', 'verification.service.ts'),
      dest: path.join(targetDir, 'server', 'src', 'modules', 'auth', 'verification.service.ts'),
    },
    {
      src: path.join(MODULES_DIR, 'server', 'verification.controller.ts'),
      dest: path.join(targetDir, 'server', 'src', 'modules', 'auth', 'verification.controller.ts'),
    },
    {
      src: path.join(MODULES_DIR, 'client', 'services', 'verification.service.ts'),
      dest: path.join(targetDir, 'client', 'src', 'features', 'auth', 'services', 'verification.service.ts'),
    },
    {
      src: path.join(MODULES_DIR, 'client', 'hooks', 'useVerification.ts'),
      dest: path.join(targetDir, 'client', 'src', 'features', 'auth', 'hooks', 'useVerification.ts'),
    },
  ];

  for (const { src, dest } of copies) {
    await fs.ensureDir(path.dirname(dest));
    await fs.copy(src, dest);
  }
}

// ─── Server Patches ─────────────────────────────────────────────

/**
 * Patch 1: auth.routes.ts
 * - Add imports for verifyAccountSchema and verificationController
 * - Append two route registrations to the authRoutes function body
 */
function patchAuthRoutes(project, targetDir) {
  const filePath = path.join(targetDir, 'server', 'src', 'modules', 'auth', 'auth.routes.ts');
  const sourceFile = project.addSourceFileAtPath(filePath);

  // Add imports for verification schemas — merge into existing schemas import if present
  const existingSchemasImport = sourceFile.getImportDeclaration(
    (decl) => decl.getModuleSpecifierValue() === './auth.schemas.js',
  );
  if (existingSchemasImport) {
    const existing = existingSchemasImport.getNamedImports().map((n) => n.getName());
    if (!existing.includes('sendVerificationSchema')) {
      existingSchemasImport.addNamedImport('sendVerificationSchema');
    }
    if (!existing.includes('verifyAccountSchema')) {
      existingSchemasImport.addNamedImport('verifyAccountSchema');
    }
  } else {
    sourceFile.addImportDeclaration({
      namedImports: ['sendVerificationSchema', 'verifyAccountSchema'],
      moduleSpecifier: './auth.schemas.js',
    });
  }

  // Add import for verification controller
  const existingVerifImport = sourceFile.getImportDeclaration(
    (decl) => decl.getModuleSpecifierValue() === './verification.controller.js',
  );
  if (!existingVerifImport) {
    sourceFile.addImportDeclaration({
      namespaceImport: 'verificationController',
      moduleSpecifier: './verification.controller.js',
    });
  }

  // Find the authRoutes function and append route statements
  const authRoutesFn = sourceFile.getFunction('authRoutes');
  if (!authRoutesFn) {
    throw new Error(
      'Could not find function "authRoutes" in auth.routes.ts — file may have been modified',
    );
  }

  authRoutesFn.addStatements(`
  // Send verification email (resend) - public, accepts email in body
  fastify.post('/auth/send-verification', {
    schema: {
      body: sendVerificationSchema,
    },
    config: {
      rateLimit: RATE_LIMITS.AUTH_SEND_VERIFICATION,
    },
    handler: verificationController.sendVerification,
  });

  // Verify account with token
  fastify.post('/auth/verify-account', {
    schema: {
      body: verifyAccountSchema,
    },
    config: {
      rateLimit: RATE_LIMITS.AUTH_VERIFY_ACCOUNT,
    },
    handler: verificationController.verifyAccount,
  });`);

  sourceFile.saveSync();
}

/**
 * Patch 2: auth.schemas.ts
 * - Append verifyAccountSchema and VerifyAccountInput type
 */
function patchAuthSchemas(project, targetDir) {
  const filePath = path.join(targetDir, 'server', 'src', 'modules', 'auth', 'auth.schemas.ts');
  const sourceFile = project.addSourceFileAtPath(filePath);

  // Check if already patched
  const existing = sourceFile.getVariableDeclaration('verifyAccountSchema');
  if (existing) return;

  sourceFile.addStatements(`
export const sendVerificationSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
});

export type SendVerificationInput = z.infer<typeof sendVerificationSchema>;

export const verifyAccountSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export type VerifyAccountInput = z.infer<typeof verifyAccountSchema>;`);

  sourceFile.saveSync();
}

/**
 * Patch 3: rate-limit.config.ts
 * - Add AUTH_SEND_VERIFICATION and AUTH_VERIFY_ACCOUNT entries
 *   after AUTH_RESET_PASSWORD in the RATE_LIMITS object
 */
function patchRateLimitConfig(project, targetDir) {
  const filePath = path.join(targetDir, 'server', 'src', 'config', 'rate-limit.config.ts');
  const sourceFile = project.addSourceFileAtPath(filePath);

  const rateLimitsVar = sourceFile.getVariableDeclaration('RATE_LIMITS');
  if (!rateLimitsVar) {
    throw new Error(
      'Could not find variable "RATE_LIMITS" in rate-limit.config.ts — file may have been modified',
    );
  }

  // Handle both `{ ... }` and `{ ... } as const` patterns
  let objectLiteral = rateLimitsVar.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
  if (!objectLiteral) {
    // Check for `as const` assertion: the initializer is an AsExpression wrapping the object literal
    const asExpr = rateLimitsVar.getInitializerIfKind(SyntaxKind.AsExpression);
    if (asExpr) {
      objectLiteral = asExpr.getExpressionIfKind(SyntaxKind.ObjectLiteralExpression);
    }
  }
  if (!objectLiteral) {
    throw new Error(
      'RATE_LIMITS is not an object literal in rate-limit.config.ts — file may have been modified',
    );
  }

  // Check if already patched
  if (objectLiteral.getProperty('AUTH_SEND_VERIFICATION')) return;

  // Use text manipulation to insert after AUTH_RESET_PASSWORD block
  // ts-morph's insertPropertyAssignment has quirks with index positioning,
  // so we use the more reliable addPropertyAssignment which appends at end
  // (position within the object doesn't matter for a config map)
  objectLiteral.addPropertyAssignment({
    name: 'AUTH_SEND_VERIFICATION',
    initializer: `{\n    max: applyMultiplier(3),\n    timeWindow: '15 minutes',\n  }`,
  });

  objectLiteral.addPropertyAssignment({
    name: 'AUTH_VERIFY_ACCOUNT',
    initializer: `{\n    max: applyMultiplier(10),\n    timeWindow: '15 minutes',\n  }`,
  });

  sourceFile.saveSync();
}

/**
 * Replace one exact text anchor, failing loudly when it is missing.
 *
 * Text anchors used to skip silently, which hid a real bug: the login resend
 * anchor never matched the template, yet the CLI reported the file as patched.
 * Now a missing anchor stops the patch with a clear error. `alreadyPatchedMarker`
 * makes re-running the patcher a no-op. Anchors are written with "\n"; they are
 * matched against CRLF files too (Windows checkouts with core.autocrlf).
 */
function replaceAnchor(content, { anchor, replacement, alreadyPatchedMarker, label, file }) {
  if (content.includes(alreadyPatchedMarker)) return content;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const anchorText = anchor.split('\n').join(eol);
  if (!content.includes(anchorText)) {
    throw new Error(
      `Could not find the ${label} in ${file} — file may have been modified. ` +
        'Apply the email-verification change by hand or restore the template code.',
    );
  }
  return content.replace(anchorText, replacement.split('\n').join(eol));
}

/**
 * Patch 4: auth.service.ts
 * - Export sanitizeUser function, SanitizedUser interface, AuthResult interface
 *   so verification.service.ts can import them
 * - Add import for sendVerification and call it during register (auto-send on
 *   signup) and on a correct-password login of an unverified, non-banned account
 */
function patchAuthService(project, targetDir) {
  const filePath = path.join(targetDir, 'server', 'src', 'modules', 'auth', 'auth.service.ts');
  const sourceFile = project.addSourceFileAtPath(filePath);

  // Export sanitizeUser function
  const sanitizeFn = sourceFile.getFunction('sanitizeUser');
  if (!sanitizeFn) {
    throw new Error(
      'Could not find function "sanitizeUser" in auth.service.ts — file may have been modified',
    );
  }
  if (!sanitizeFn.isExported()) {
    sanitizeFn.setIsExported(true);
  }

  // Export SanitizedUser interface
  const sanitizedUserIface = sourceFile.getInterface('SanitizedUser');
  if (!sanitizedUserIface) {
    throw new Error(
      'Could not find interface "SanitizedUser" in auth.service.ts — file may have been modified',
    );
  }
  if (!sanitizedUserIface.isExported()) {
    sanitizedUserIface.setIsExported(true);
  }

  // Export AuthResult interface
  const authResultIface = sourceFile.getInterface('AuthResult');
  if (!authResultIface) {
    throw new Error(
      'Could not find interface "AuthResult" in auth.service.ts — file may have been modified',
    );
  }
  if (!authResultIface.isExported()) {
    authResultIface.setIsExported(true);
  }

  // Add import for sendVerification from verification.service (if not already present)
  const existingVerifImport = sourceFile.getImportDeclaration(
    (decl) => decl.getModuleSpecifierValue() === './verification.service.js',
  );
  if (!existingVerifImport) {
    sourceFile.addImportDeclaration({
      namedImports: ['sendVerification'],
      moduleSpecifier: './verification.service.js',
    });
  }

  // Inject sendVerification call in the register function's verification branch.
  // We do this via text replacement on the file content since ts-morph AST traversal
  // of if-statement bodies to find a specific return pattern is fragile.
  sourceFile.saveSync();

  const content = fs.readFileSync(filePath, 'utf-8');
  let patched = content;

  // Patch 1: Auto-send verification email on registration
  patched = replaceAnchor(patched, {
    file: 'auth.service.ts',
    label: 'register verification branch',
    alreadyPatchedMarker: 'sendVerification(input.email)',
    anchor: '  if (requiresVerification) {\n    return {\n      user: sanitizeUser(user),\n      requiresVerification: true,\n    };\n  }',
    replacement:
      '  if (requiresVerification) {\n' +
      "    // Auto-send verification email on registration (best-effort, don't block registration)\n" +
      '    sendVerification(input.email).catch(() => {});\n\n' +
      '    return {\n      user: sanitizeUser(user),\n      requiresVerification: true,\n    };\n  }',
  });

  // Patch 2: Re-send a fresh link when an unverified user logs in with the
  // correct password. It runs after the password check, so an anonymous caller
  // cannot trigger emails, and never for a banned account (verification cannot
  // lift a ban). assertAccountCanSignIn then answers 403 EMAIL_NOT_VERIFIED.
  patched = replaceAnchor(patched, {
    file: 'auth.service.ts',
    label: 'login account-state check',
    alreadyPatchedMarker: 'sendVerification(user.email)',
    anchor:
      '  // Reveal account state only now that the password is proven, so an anonymous\n' +
      '  // caller cannot learn whether an email is banned or unverified.\n' +
      '  assertAccountCanSignIn(user);',
    replacement:
      '  // Reveal account state only now that the password is proven, so an anonymous\n' +
      '  // caller cannot learn whether an email is banned or unverified.\n' +
      '  // Email-verification module: re-send a fresh link to an unverified (not banned) account.\n' +
      '  if (user.isActive && env.REQUIRE_USER_VERIFICATION && !user.emailVerifiedAt) {\n' +
      '    sendVerification(user.email).catch(() => {});\n' +
      '  }\n' +
      '  assertAccountCanSignIn(user);',
  });

  if (patched !== content) {
    fs.writeFileSync(filePath, patched, 'utf-8');
  }
}

/**
 * Patch 5: auth.repo.ts
 * - Add markEmailVerified function at end of file
 *
 * It sets emailVerifiedAt only for an active, not-yet-verified, non-deleted
 * account and never touches isActive (the admin ban switch). The conditional
 * write means a ban that lands mid-verification still wins. Returns whether a
 * row was updated.
 */
function patchAuthRepo(project, targetDir) {
  const filePath = path.join(targetDir, 'server', 'src', 'modules', 'auth', 'auth.repo.ts');
  const sourceFile = project.addSourceFileAtPath(filePath);

  // Check if already patched
  const existing = sourceFile.getFunction('markEmailVerified');
  if (existing) return;

  sourceFile.addFunction({
    name: 'markEmailVerified',
    isExported: true,
    isAsync: true,
    parameters: [
      { name: 'userId', type: 'string' },
      { name: 'verifiedAt', type: 'Date' },
    ],
    returnType: 'Promise<boolean>',
    statements: `const result = await prisma.user.updateMany({
    where: { id: userId, isActive: true, emailVerifiedAt: null, deletedAt: null },
    data: { emailVerifiedAt: verifiedAt },
  });
  return result.count === 1;`,
  });

  sourceFile.saveSync();
}

// ─── Client Patches ─────────────────────────────────────────────

/**
 * Patch 6: api-endpoints.ts
 * - Add SEND_VERIFICATION and VERIFY_ACCOUNT to the AUTH object
 */
function patchApiEndpoints(project, targetDir) {
  const filePath = path.join(targetDir, 'client', 'src', 'lib', 'constants', 'api-endpoints.ts');
  const sourceFile = project.addSourceFileAtPath(filePath);

  const apiEndpointsVar = sourceFile.getVariableDeclaration('API_ENDPOINTS');
  if (!apiEndpointsVar) {
    throw new Error(
      'Could not find variable "API_ENDPOINTS" in api-endpoints.ts — file may have been modified',
    );
  }

  let outerObject = apiEndpointsVar.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
  if (!outerObject) {
    const asExpr = apiEndpointsVar.getInitializerIfKind(SyntaxKind.AsExpression);
    if (asExpr) {
      outerObject = asExpr.getExpressionIfKind(SyntaxKind.ObjectLiteralExpression);
    }
  }
  if (!outerObject) {
    throw new Error(
      'API_ENDPOINTS is not an object literal in api-endpoints.ts — file may have been modified',
    );
  }

  const authProp = outerObject.getProperty('AUTH');
  if (!authProp) {
    throw new Error(
      'Could not find AUTH property in API_ENDPOINTS — file may have been modified',
    );
  }

  // Get the AUTH object's initializer
  const authInitializer = authProp.getChildrenOfKind(SyntaxKind.ObjectLiteralExpression)[0];
  if (!authInitializer) {
    throw new Error(
      'AUTH property is not an object literal — file may have been modified',
    );
  }

  // Check if already patched
  if (authInitializer.getProperty('SEND_VERIFICATION')) return;

  authInitializer.addPropertyAssignment({
    name: 'SEND_VERIFICATION',
    initializer: `'/auth/send-verification'`,
  });

  authInitializer.addPropertyAssignment({
    name: 'VERIFY_ACCOUNT',
    initializer: `'/auth/verify-account'`,
  });

  sourceFile.saveSync();
}

/**
 * Patch 7: error.ts
 * - Add ALREADY_VERIFIED and INVALID_VERIFICATION_TOKEN to ERROR_CODES
 */
function patchErrorCodes(project, targetDir) {
  const filePath = path.join(targetDir, 'client', 'src', 'lib', 'utils', 'error.ts');
  const sourceFile = project.addSourceFileAtPath(filePath);

  const errorCodesVar = sourceFile.getVariableDeclaration('ERROR_CODES');
  if (!errorCodesVar) {
    throw new Error(
      'Could not find variable "ERROR_CODES" in error.ts — file may have been modified',
    );
  }

  let errorCodesObject = errorCodesVar.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
  if (!errorCodesObject) {
    const asExpr = errorCodesVar.getInitializerIfKind(SyntaxKind.AsExpression);
    if (asExpr) {
      errorCodesObject = asExpr.getExpressionIfKind(SyntaxKind.ObjectLiteralExpression);
    }
  }
  if (!errorCodesObject) {
    throw new Error(
      'ERROR_CODES is not an object literal in error.ts — file may have been modified',
    );
  }

  // Check if already patched
  if (errorCodesObject.getProperty('ALREADY_VERIFIED')) return;

  errorCodesObject.addPropertyAssignment({
    name: 'ALREADY_VERIFIED',
    initializer: `'ALREADY_VERIFIED'`,
  });

  errorCodesObject.addPropertyAssignment({
    name: 'INVALID_VERIFICATION_TOKEN',
    initializer: `'INVALID_VERIFICATION_TOKEN'`,
  });

  sourceFile.saveSync();
}

/**
 * Patch 8: useAuth.ts (client)
 * - Redirect to /verify-account when login fails with EMAIL_NOT_VERIFIED
 *   (the server auto-resends the verification email on this error).
 *   Banned accounts (ACCOUNT_DEACTIVATED) are deliberately NOT sent there:
 *   verifying an email cannot lift a ban.
 */
function patchUseAuthHook(targetDir) {
  const filePath = path.join(targetDir, 'client', 'src', 'features', 'auth', 'hooks', 'useAuth.ts');
  if (!fs.pathExistsSync(filePath)) {
    throw new Error('Could not find client/src/features/auth/hooks/useAuth.ts — file may have been moved');
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  const patched = replaceAnchor(content, {
    file: 'useAuth.ts',
    label: 'EMAIL_NOT_VERIFIED login error toast',
    alreadyPatchedMarker: 'We sent you a new verification link',
    anchor: "toast.error('Please verify your email address before signing in.');",
    replacement:
      "toast.error('Please verify your email address. We sent you a new verification link.');\n" +
      '        router.push(ROUTES.VERIFY_ACCOUNT);',
  });

  if (patched !== content) {
    fs.writeFileSync(filePath, patched, 'utf-8');
  }
}

// ─── Postman Patch ──────────────────────────────────────────────

/**
 * Patch 8: postman/collection.json
 * - Add "Send Verification" and "Verify Account" requests to the Auth folder
 */
async function patchPostmanCollection(targetDir) {
  const filePath = path.join(targetDir, 'server', 'postman', 'collection.json');
  if (!(await fs.pathExists(filePath))) return;

  const collection = await fs.readJson(filePath);

  // Find the Auth folder (first item with name "Auth")
  const authFolder = collection.item?.find((folder) => folder.name === 'Auth');
  if (!authFolder) {
    throw new Error(
      'Could not find "Auth" folder in Postman collection — file may have been modified',
    );
  }

  // Check if already patched
  const alreadyPatched = authFolder.item?.some(
    (req) => req.name === 'Send Verification',
  );
  if (alreadyPatched) return;

  // Add Send Verification request (public — accepts email in body)
  authFolder.item.push({
    name: 'Send Verification',
    request: {
      auth: {
        type: 'noauth',
      },
      method: 'POST',
      header: [
        {
          key: 'Content-Type',
          value: 'application/json',
        },
      ],
      body: {
        mode: 'raw',
        raw: '{\n  "email": "john.doe@example.com"\n}',
      },
      url: {
        raw: '{{baseUrl}}/auth/send-verification',
        host: ['{{baseUrl}}'],
        path: ['auth', 'send-verification'],
      },
      description:
        'Resend the verification email. Public endpoint — no authentication required. Always returns success to prevent email enumeration. A verification email is also sent automatically on registration. Rate limited to 3 requests per 15 minutes.',
    },
    response: [],
  });

  // Add Verify Account request (public)
  authFolder.item.push({
    name: 'Verify Account',
    request: {
      auth: {
        type: 'noauth',
      },
      method: 'POST',
      header: [
        {
          key: 'Content-Type',
          value: 'application/json',
        },
      ],
      body: {
        mode: 'raw',
        raw: '{\n  "token": "paste-verification-token-from-email-here"\n}',
      },
      url: {
        raw: '{{baseUrl}}/auth/verify-account',
        host: ['{{baseUrl}}'],
        path: ['auth', 'verify-account'],
      },
      description:
        'Verify a user account using the token from the verification email. Public endpoint — no authentication required. On success, sets auth cookies (access_token + refresh_token) so the user is immediately logged in.',
    },
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            'if (pm.response.code === 200) {',
            '  const res = pm.response.json();',
            '  if (res.data && res.data.user) {',
            "    pm.collectionVariables.set('userId', res.data.user.id);",
            '  }',
            '  // Tokens are set via httpOnly cookies, not in response body',
            '}',
          ],
        },
      },
    ],
    response: [],
  });

  await fs.writeJson(filePath, collection, { spaces: 2 });
}
