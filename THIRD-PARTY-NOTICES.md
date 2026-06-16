# Third-Party Notices

supaschema is **dual-licensed**:

- **AGPL-3.0-only** — see [`LICENSE`](./LICENSE).
- **Commercial license** — see [`LICENSE-COMMERCIAL.md`](./LICENSE-COMMERCIAL.md).

Choose the license that fits your use. The AGPL-3.0-only terms apply unless you hold a separate commercial license.

This file is a concise attribution notice for supaschema's **direct runtime dependencies** (the packages shipped to and resolved by consumers at runtime). It is not an exhaustive listing of the full transitive dependency tree; each dependency carries its own license and may pull in further dependencies under their respective terms. Run `npm ls --omit=dev` for the resolved runtime tree.

## Direct runtime dependencies

All direct runtime dependencies are distributed under the **MIT License**.

| Package | License | Source |
| --- | --- | --- |
| `commander` | MIT | https://github.com/tj/commander.js |
| `libpg-query` | MIT | https://github.com/constructive-io/libpg-query-node |
| `pg` | MIT | https://github.com/brianc/node-postgres |
| `pgsql-deparser` | MIT | https://github.com/constructive-io/pgsql-parser |
| `zod` | MIT | https://github.com/colinhacks/zod |

### MIT License

Each MIT-licensed dependency above is provided under the following terms (with copyright held by the respective package authors and contributors):

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The full license text for each dependency is included in that package's distribution under `node_modules/<package>/` (e.g. its `LICENSE` file and the `license` field in its `package.json`).
