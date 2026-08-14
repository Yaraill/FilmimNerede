
const fs = require('fs');

const code = fs.readFileSync('app.js', 'utf-8');
const lines = code.split('\n');

const stateFile = [];
const apiFile = [];
const uiFile = [];
const storageFile = [];
const gameFile = [];
let appFile = [];

// ... wait, parsing functions line by line with a JS script is prone to brace mismatch.
// It is better to use an AST parser.
// But we don't have one installed (like babel).

