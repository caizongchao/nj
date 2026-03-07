import fs from 'fs';
// import { ninja } from './ninja';
import * as njmodule from './ninja';

var nj = njmodule;
var ninja = nj.ninja;

let argv = process.argv.slice(2);

var script_fname; if (argv.length > 0) {
    const s = argv[0]; if (!s.startsWith('-')) {
        script_fname = argv.shift();
    }
}

if (!script_fname) {
    script_fname = './build.js';
}

ninja.argv = argv;

global.nj = nj;
global.ninja = ninja;

import(script_fname).then(() => { }, (err) => {
    console.error(err); process.exit(1);
});


