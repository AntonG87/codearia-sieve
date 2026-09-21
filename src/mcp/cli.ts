#!/usr/bin/env node
// Entry point for `npx -y codearia-sieve` and for agent configs:
//   { "mcpServers": { "sieve": { "command": "npx", "args": ["-y", "codearia-sieve"] } } }

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.ts';

const server = createServer();
await server.connect(new StdioServerTransport());
