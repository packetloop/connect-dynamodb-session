'use strict';


const test = require('blue-tape');
const spec = require('tap-spec');
const glob = require('glob');
const path = require('path');
const fs = require('fs');
const report = fs.createWriteStream('reports/test.xml');
const xunit = require('tap-xunit');

const stream = test.createStream();
stream.pipe(xunit()).pipe(report);
stream.pipe(spec()).pipe(process.stdout);

const filesToTest = process.argv[2] || 'test/unit/**/*-test.js';

glob.sync(filesToTest, {realpath: true, cwd: path.resolve(__dirname, '../..')}).forEach(require);
