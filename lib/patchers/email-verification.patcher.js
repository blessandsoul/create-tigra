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
 * Patch 4: auth.service.ts
 * - Export sanitizeUser function, SanitizedUser interface, AuthResult interface
 *   so verification.service.ts can import them
 * - Add import for sendVerification and call it during register (auto-send on signup)
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
  const registerAnchor = 'if (!isActive) {\n    return {\n      user: sanitizeUser(user),\n      requiresVerification: true,\n    };\n  }';
  if (patched.includes(registerAnchor) && !patched.includes('sendVerification(input.email)')) {
    const registerReplacement = `if (!isActive) {\n    // Auto-send verification email on registration (best-effort, don't block registration)\n    sendVerification(input.email).catch(() => {});\n\n    return {\n      user: sanitizeUser(user),\n      requiresVerification: true,\n    };\n  }`;
    patched = patched.replace(registerAnchor, registerReplacement);
  }

  // Patch 2: Auto-resend verification email when inactive user tries to log in
  const loginAnchor = "    if (!user.isActive) {\n      throw new ForbiddenError('Account is not activated. Please verify your account.', 'ACCOUNT_NOT_ACTIVE');\n    }";
  if (patched.includes(loginAnchor) && !patched.includes('sendVerification(user.email)')) {
    const loginReplacement = "    if (!user.isActive) {\n      // Auto-resend verification email so user gets a fresh link\n      sendVerification(user.email).catch(() => {});\n\n      throw new ForbiddenError('Account is not activated. Please verify your account.', 'ACCOUNT_NOT_ACTIVE');\n    }";
    patched = patched.replace(loginAnchor, loginReplacement);
  }

  if (patched !== content) {
    fs.writeFileSync(filePath, patched, 'utf-8');
  }
}

/**
 * Patch 5: auth.repo.ts
 * - Add activateUser function at end of file
 */
function patchAuthRepo(project, targetDir) {
  const filePath = path.join(targetDir, 'server', 'src', 'modules', 'auth', 'auth.repo.ts');
  const sourceFile = project.addSourceFileAtPath(filePath);

  // Check if already patched
  const existing = sourceFile.getFunction('activateUser');
  if (existing) return;

  sourceFile.addFunction({
    name: 'activateUser',
    isExported: true,
    isAsync: true,
    parameters: [{ name: 'userId', type: 'string' }],
    returnType: 'Promise<void>',
    statements: `await prisma.user.update({
    where: { id: userId },
    data: { isActive: true },
  });`,
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
 * - Redirect to /verify-account when login fails with ACCOUNT_NOT_ACTIVE
 *   (the server auto-resends the verification email on this error)
 */
function patchUseAuthHook(targetDir) {
  const filePath = path.join(targetDir, 'client', 'src', 'features', 'auth', 'hooks', 'useAuth.ts');
  if (!fs.pathExistsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf-8');

  // Check if already patched — look for the specific replacement text
  if (content.includes('Check your email for a verification link')) return;

  // Find the ACCOUNT_NOT_ACTIVE error handler and add redirect + update message.
  // Match regardless of exact indentation by searching for the key content.
  const anchorText = "toast.error('Your account is not yet activated. Please verify your account to continue.');";

  if (!content.includes(anchorText)) return; // File may have been modified

  // Replace the toast message and add router.push right after it
  const patched = content.replace(
    anchorText,
    "toast.error('Your account is not yet activated. Check your email for a verification link.');\n        router.push(ROUTES.VERIFY_ACCOUNT);",
  );

  fs.writeFileSync(filePath, patched, 'utf-8');
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
