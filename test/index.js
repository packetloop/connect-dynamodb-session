import test from 'blue-tape';
import spec from 'tap-spec';
import glob from 'glob';
import path from 'path';
import fs from 'fs';
import xunit from 'tap-xunit';

const report = fs.createWriteStream(path.join(__dirname, '..', 'reports', 'test.xml'));
const stream = test.createStream();
stream.pipe(xunit()).pipe(report);
stream.pipe(spec()).pipe(process.stdout);

const filesToTest = process.argv[2] || 'test/**/*-test.js';
glob.sync(filesToTest, {realpath: true, cwd: path.join(__dirname, '..')}).forEach(require);
