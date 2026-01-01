# Contributing to Textrawl

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js >= 22.0.0
- Docker (for local database)
- A Supabase account OR local PostgreSQL with pgvector
- OpenAI API key (for embeddings)

### Quick Start

```bash
# Clone the repo
git clone https://github.com/your-username/textrawl.git
cd textrawl

# Install dependencies
npm install

# Run the setup script (generates .env with secure token)
npm run setup

# Start local database (optional - or use Supabase)
docker-compose -f docker-compose.local.yml up -d postgres

# Initialize the database
docker exec -i textrawl-postgres psql -U postgres -d textrawl < scripts/setup-db.sql

# Start dev server
npm run dev
```

### Available Scripts

```bash
npm run dev         # Watch mode with hot reload
npm run build       # Production build
npm run typecheck   # Type-check without emitting
npm run inspector   # Test with MCP Inspector
```

## Code Style

### ESM Imports

This is an ES module project. **All imports must use `.js` extensions**, even for TypeScript files:

```typescript
// Correct
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

// Wrong - will fail at runtime
import { logger } from '../utils/logger';
```

### Logging

**Never use `console.log()`** - stdout is reserved for MCP JSON-RPC communication.

Always use the logger from `src/utils/logger.ts`:

```typescript
import { logger } from '../utils/logger.js';

logger.info('Something happened', { key: 'value' });
logger.error('Something failed', { error: err.message });
```

### Error Handling

Use the custom error hierarchy from `src/utils/errors.ts`:

```typescript
import { NotFoundError, ValidationError } from '../utils/errors.js';

throw new NotFoundError('Document not found');
throw new ValidationError('Invalid input');
```

### MCP Tool Pattern

Tools are registered with inline Zod schemas and return structured content:

```typescript
server.tool('tool_name', {
  param: z.string().describe('Description'),
}, async ({ param }) => {
  const result = await doSomething(param);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  };
});
```

## Project Structure

```
src/
├── api/           # Express routes and middleware
├── db/            # Database queries (Supabase)
├── services/      # Business logic (embeddings, chunking)
├── tools/         # MCP tool definitions
├── types/         # TypeScript type definitions
└── utils/         # Config, logger, errors
```

## Pull Request Process

1. **Fork and branch**: Create a feature branch from `main`
2. **Make changes**: Follow the code style guidelines above
3. **Type check**: Run `npm run typecheck` and fix any errors
4. **Test locally**: Verify your changes work with `npm run dev`
5. **Commit**: Use clear, descriptive commit messages
6. **Open PR**: Describe what you changed and why

### Commit Messages

Use conventional commit format when possible:

```
feat: add support for .epub files
fix: handle empty search results gracefully
docs: update API documentation
refactor: simplify chunking logic
```

## Reporting Bugs

Open an issue with:

1. **Description**: What happened vs. what you expected
2. **Steps to reproduce**: Minimal steps to trigger the bug
3. **Environment**: Node version, OS, relevant config
4. **Logs**: Any error messages (sanitize sensitive data)

## Feature Requests

Open an issue describing:

1. **Use case**: What problem are you trying to solve?
2. **Proposed solution**: How you'd like it to work
3. **Alternatives considered**: Other approaches you thought of

## Questions?

Open a discussion or issue - we're happy to help!
