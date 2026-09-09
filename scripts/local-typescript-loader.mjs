import { readFile, access } from 'node:fs/promises';
import ts from 'typescript';

// Real local tooling, not tests/register.mjs: never substitute mocked bindings.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers')
    throw new Error(
      'Sites runtime bindings are not available to local provisioning.',
    );
  if (specifier.startsWith('.') || specifier.startsWith('@/')) {
    const target = specifier.startsWith('@/')
      ? new URL(`../${specifier.slice(2)}`, import.meta.url)
      : new URL(specifier, context.parentURL);
    for (const suffix of ['', '.ts', '.tsx']) {
      try {
        const url = `${target.href}${suffix}`;
        await access(new URL(url));
        return { url, shortCircuit: true };
      } catch {
        /* Try the next extension. */
      }
    }
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx'))
    return {
      format: 'module',
      shortCircuit: true,
      source: ts.transpileModule(await readFile(new URL(url), 'utf8'), {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
    };
  return nextLoad(url, context);
}
