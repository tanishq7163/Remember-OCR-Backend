import type { SwaggerUiOptions } from 'swagger-ui-express';

export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'REMEMBER — OCR Pipeline API',
    version: '1.0.0',
    description:
      'OCR / Content Extraction Pipeline for REMEMBER.\n\n' +
      '**Flow:** `IMAGE / PDF → OCR → RAW TEXT` — the LLM layer is intentionally separate.\n\n' +
      'All `/api/memories/*` endpoints require a Bearer JWT. ' +
      'Use `GET /api/dev-token` (dev mode only) to get one instantly.',
  },
  servers: [{ url: 'http://localhost:3001', description: 'Local dev server' }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Click **Authorize**, paste a token. Get one from `GET /api/dev-token`.',
      },
    },
    schemas: {
      OcrStatus: {
        type: 'string',
        enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED'],
        example: 'COMPLETED',
      },
      OcrPage: {
        type: 'object',
        properties: {
          pageNumber: { type: 'integer', example: 1 },
          text: { type: 'string', example: 'MacBook Air M4\n₹94,990\nApple India' },
          confidence: { type: 'number', format: 'float', example: 0.96 },
        },
      },
      OcrResult: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'clz1abc123' },
          memoryId: { type: 'string', example: 'memory-001' },
          status: { $ref: '#/components/schemas/OcrStatus' },
          extractedText: { type: 'string', nullable: true, example: 'MacBook Air M4\n₹94,990\nApple India\nAvailable now' },
          language: { type: 'string', nullable: true, example: 'en' },
          confidence: { type: 'number', nullable: true, example: 0.96 },
          provider: { type: 'string', example: 'google_vision' },
          providerVersion: { type: 'string', nullable: true },
          processedAt: { type: 'string', format: 'date-time', nullable: true },
          errorMessage: { type: 'string', nullable: true },
          retryCount: { type: 'integer', example: 0 },
          pages: { type: 'array', items: { $ref: '#/components/schemas/OcrPage' } },
        },
      },
      OcrHandoff: {
        type: 'object',
        description: 'Minimal payload for the LLM engine. OCR responsibility ends here.',
        properties: {
          memoryId: { type: 'string', example: 'memory-001' },
          sourceType: { type: 'string', enum: ['IMAGE', 'PDF'], example: 'IMAGE' },
          extractedText: { type: 'string', example: 'MacBook Air M4\n₹94,990\nApple India\nAvailable now' },
          language: { type: 'string', nullable: true, example: 'en' },
          pages: { type: 'array', items: { $ref: '#/components/schemas/OcrPage' } },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string', example: 'Memory not found.' } },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  tags: [
    { name: 'System', description: 'Health and developer utilities' },
    { name: 'OCR', description: 'Upload, poll, retry, and hand off extracted text' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        security: [],
        responses: {
          200: { description: 'Server is running', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, service: { type: 'string', example: 'remember-ocr' } } } } } },
        },
      },
    },
    '/api/dev-token': {
      get: {
        tags: ['System'],
        summary: 'Generate a dev JWT (development mode only)',
        description: 'Returns a signed JWT for `userId: dev-user`. **Disabled in production.**',
        security: [],
        responses: {
          200: { description: 'Token', content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string' }, userId: { type: 'string', example: 'dev-user' }, expiresIn: { type: 'string', example: '7d' } } } } } },
          404: { description: 'Not available in production', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/memories/{id}/ocr': {
      post: {
        tags: ['OCR'],
        summary: 'Upload a file and trigger OCR',
        description:
          'Saves the file immediately and returns **202 Accepted**. ' +
          'OCR runs asynchronously in the background. ' +
          'Poll `GET /api/memories/{id}/ocr` to check progress.\n\n' +
          '**Supported:** JPEG · PNG · WebP · PDF (max 50 MB)',
        parameters: [{ name: 'id', in: 'path', required: true, description: 'Your chosen memory ID', schema: { type: 'string', example: 'memory-001' } }],
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } },
        },
        responses: {
          202: { description: 'Accepted — OCR queued', content: { 'application/json': { schema: { type: 'object', properties: { memoryId: { type: 'string' }, status: { type: 'string', example: 'PENDING' }, message: { type: 'string' } } } } } },
          400: { description: 'No file or invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Missing or invalid JWT', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          429: { description: 'Rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      get: {
        tags: ['OCR'],
        summary: 'Get OCR status and result',
        description: 'Poll until `status` is `COMPLETED`, `FAILED`, or `PARTIAL`.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'memory-001' } }],
        responses: {
          200: { description: 'Current OCR state', content: { 'application/json': { schema: { $ref: '#/components/schemas/OcrResult' } } } },
          401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/memories/{id}/ocr/retry': {
      post: {
        tags: ['OCR'],
        summary: 'Retry a failed OCR job',
        description: 'Re-queues OCR for a memory with status `FAILED` or `PARTIAL`.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'memory-001' } }],
        responses: {
          202: { description: 'Retry queued' },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'OCR already in progress', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          429: { description: 'Max retries reached', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/memories/{id}/ocr/handoff': {
      get: {
        tags: ['OCR'],
        summary: 'Get LLM handoff payload',
        description: 'Returns the clean normalised text for the LLM understanding engine. Only available when `status = COMPLETED`.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'memory-001' } }],
        responses: {
          200: { description: 'Handoff payload', content: { 'application/json': { schema: { $ref: '#/components/schemas/OcrHandoff' } } } },
          409: { description: 'OCR not yet complete', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
};

export const swaggerUiOptions: SwaggerUiOptions = {
  customSiteTitle: 'REMEMBER OCR API',
  customCss: '.swagger-ui .topbar { background-color: #0d0d14; } .swagger-ui .topbar .download-url-wrapper { display: none; }',
  swaggerOptions: { persistAuthorization: true },
};