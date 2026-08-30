import { readFile, access } from 'node:fs/promises';
import ts from 'typescript';
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers')
    return {
      url: new URL('./runtime-mock.mjs', import.meta.url).href,
      shortCircuit: true,
    };
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
        /* Try a TS extension. */
      }
    }
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const source = await readFile(new URL(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
    };
  }
  return nextLoad(url, context);
}
