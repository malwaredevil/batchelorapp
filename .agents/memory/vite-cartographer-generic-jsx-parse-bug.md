---
name: Cartographer breaks generic-typed JSX in dev
description: Vite dev + Replit cartographer instrumentation plugin fails to parse JSX call sites with explicit generic type args like <Component<T> ...>, causing a 500 on the whole page.
---

Any JSX element using an explicit generic type argument (e.g. `<InlineField<string> {...props} />`) can fail to parse under Vite dev when the `replit-cartographer` instrumentation plugin is active — it injects a `data-component-name` attribute into the tag and the combined Babel pipeline chokes on the `<T>` syntax, throwing a Babel parse error that 500s every route in that artifact, not just the offending page.

**Why:** Hit this in the Travels app — `InlineField<T>`'s generic component definition was fine, but every JSX call site that supplied an explicit type argument broke parsing repo-wide.

**How to apply:** If a Vite artifact suddenly 500s on every page with a Babel/parse error mentioning a generic-looking JSX tag, search for `<ComponentName<` call sites and drop the explicit type argument — TypeScript can usually still infer `T` from props like `value`/`onSave` without it. Leave the component's own generic function signature (`function Foo<T>(...)`) untouched; only the JSX call sites need fixing.
