> **SCOPE**: These rules apply specifically to the **server** directory.

# Response Handling

All API responses follow a unified contract. No exceptions.

---

## Success Response

```json
{
  "success": true,
  "message": "Human-readable message",
  "data": {}
}
```

- `data` can be an object, array, or null
- Controllers MUST use the shared `successResponse()` helper

```typescript
// Allowed
return reply.send(successResponse("Item created successfully", item));

// Forbidden — never send raw values or custom shapes
reply.send(item);
reply.send({ data: item });
reply.send({ success: true, item });
```

---

## Error Response

```json
{
  "success": false,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable, user-safe message"
  }
}
```

- `code`: stable machine-readable string (e.g. `RESOURCE_NOT_FOUND`, `VALIDATION_FAILED`)
- Never expose internal details, stack traces, or SQL errors
- Controllers MUST NOT manually construct error responses

---

## Paginated Response

```json
{
  "success": true,
  "message": "string",
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 10,
      "totalItems": 237,
      "totalPages": 24,
      "hasNextPage": true,
      "hasPreviousPage": false
    }
  }
}
```

Controllers MUST use the shared `paginatedResponse()` helper:

```typescript
function paginatedResponse<T>(message: string, items: T[], page: number, limit: number, totalItems: number)

// Allowed
return reply.send(paginatedResponse("Items retrieved successfully", items, page, limit, totalCount));
```

### Pagination Input Validation

All paginated endpoints MUST validate with this shared Zod schema:

```typescript
const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10)
});
```

### Service Return Pattern for Pagination

Services return `{ items, totalItems }`. Controllers build the pagination metadata.

```typescript
// Service returns:
return { items, totalItems: count };
// Offset calculation: (page - 1) * limit
```

### Filters with Pagination

- Apply filters/sorting BEFORE `limit` and `offset`
- Count total items AFTER filters but BEFORE pagination
- Pages start at 1 (never 0)

---

## Error Architecture

ONE global Fastify error handler via `fastify.setErrorHandler(...)`:
- Maps `AppError` subclasses to HTTP status codes
- Formats the unified error JSON structure
- Logs internal details server-side only — never sends to client

### AppError Subclasses

All errors MUST extend `AppError` (which defines `code`, `message`, `statusCode`). Only throw these typed subclasses — never raw `Error`, strings, or plain objects.

| Class | Status | Example Code |
|-------|--------|--------------|
| `BadRequestError` | 400 | `INVALID_INPUT` |
| `ValidationError` | 422 | `VALIDATION_FAILED` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `RESOURCE_NOT_FOUND` |
| `ConflictError` | 409 | `EMAIL_ALREADY_EXISTS` |
| `InternalError` | 500 | `INTERNAL_ERROR` |

---

## Controller Response Rules

**ALWAYS:**
- Use `successResponse()` or `paginatedResponse()` for all responses
- Validate input with Zod before calling services
- Throw typed `AppError` subclasses on failure

**NEVER:**
- Send raw values or custom JSON shapes
- Set HTTP status codes for errors (global handler does this)
- Catch errors unless rethrowing as typed `AppError`
- Manually construct error response JSON
