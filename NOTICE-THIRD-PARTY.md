# Third-party notices

## Body diagram geometry — `src/lib/body-geometry.js`

The muscle outlines drawn by the Stats page's body map are **not original work**.

They are derived from [**MuscleMap**](https://github.com/melihcolpan/MuscleMap) by Melih
Colpan, obtained via [openGym](https://github.com/DuarteSantos8/openGym)
(`frontend/src/lib/body-paths.js`), used under the **MIT License** reproduced below.

`src/lib/body-geometry.js` is **generated** and contains openGym's `male` figure copied
whole — both views, all 167 paths, unfiltered. The female figure is not included: it would
nearly double the payload to ~93 KB and this app has no setting to choose it.

Regenerate with:

```
node scripts/gen-body-geometry.mjs <openGym>/frontend/src/lib/body-paths.js
```

`npm run verify:geometry` asserts the output is byte-for-byte identical to upstream when a
checkout is supplied via `OPEN_GYM_BODY_PATHS`, and always checks that every muscle the page
draws has geometry. Do not hand-edit the path data.

```
MIT License

Copyright (c) 2026 Melih Colpan

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

## openGym — structural reference

`src/lib/muscles.js` and the shade-ramp CSS in `src/index.css` follow the *approach* used by
openGym, which is licensed under the **GNU AGPL v3.0**. No AGPL code was copied: the muscle
taxonomy and colour ramps here are written from scratch against this app's data model and its
CSS custom properties. What was taken is the idea of collapsing loose exercise metadata onto
a fixed set of drawable regions with weights that sum to one.

The existing exercise index (`public/exercises-index.json`) is generated from
`hasaneyldrm/exercises-dataset`, which is unrelated to openGym's catalogue.

## Exercise media

The app fetches exercise images from `raw.githubusercontent.com/hasaneyldrm/exercises-dataset`
at runtime, from the CDN the dataset publishes. No image data is stored in this repository.
