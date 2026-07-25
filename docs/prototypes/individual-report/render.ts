// PROTOTYPE -- throwaway. Inlines app.css, app.js and data.json into one self-contained
// index.html, so the page opens straight off the filesystem (a fetch() of data.json over
// file:// is blocked, and a local server is one more thing to explain).
//
//   deno run --allow-read --allow-write docs/prototypes/individual-report/render.ts
//   open docs/prototypes/individual-report/index.html

const DIR = "docs/prototypes/individual-report";
const read = (name: string) => Deno.readTextFileSync(`${DIR}/${name}`);

const html = `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prototip — raport individual pe adresă</title>
<style>
${read("app.css")}
</style>
</head>
<body>
<div class="protohead" id="head"></div>
<main id="page"></main>

<div id="bar">
  <button id="prev" title="Varianta anterioară (←)">←</button>
  <span class="name"></span>
  <button id="next" title="Varianta următoare (→)">→</button>
  <select id="addr" title="Adresa"></select>
</div>
<div id="tip"></div>

<script>
const DATA = ${read("data.json")};
</script>
<script>
${read("app.js")}
</script>
</body>
</html>
`;

Deno.writeTextFileSync(`${DIR}/index.html`, html);
console.error(`wrote ${DIR}/index.html (${(html.length / 1024).toFixed(0)} KB)`);
