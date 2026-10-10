#!/usr/bin/env node

/**
 * The install step links this entry before postinstall builds the CLI.
 *
 * Call stack:
 * run.mjs
 *   -> {@link ../dist/bin/run.mjs}
 */
void import(new URL('../dist/bin/run.mjs', import.meta.url).href)
