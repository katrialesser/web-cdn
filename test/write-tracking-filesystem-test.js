/**
 * Created by ThatJoeMoore on 1/31/17
 */
"use strict";

const chai = require('chai');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const chaiAsPromised = require('chai-as-promised');

const WriteTrackingFilesystem = require('../lib/write-tracking-filesystem');

chai.use(chaiAsPromised);

const should = chai.should();

fs.emptyDirSync(path.join(__dirname, '.tmp', 'tests'));

describe('Write-Tracking Filesystem', function () {
    let baseDir = fs.mkdtempSync(path.join(__dirname, '.tmp', 'tests', 'wtfs-'));
    let fixture;
    beforeEach(function () {
        setupTestFilesystem(baseDir);
        return WriteTrackingFilesystem.create(baseDir)
            .then(wtfs => fixture = wtfs);
    });

    afterEach(function() {
        fs.removeSync(baseDir);
    });

    it('scans its base on startup', function() {
        should.exist(fixture);
        fixture.should.have.property('paths').that.is.eql({
        });
    });
});

const testFileStructure = {
    dir1: {
        dir1: {
            file1: 'file1',
            file2: 'file2'
        }
    },
    dir2: {
        file1: 'file1'
    },
    link1: '>>dir2'
};


function setupTestFilesystem(base) {
    fs.emptyDirSync(base);
    setupDir(base, testFileStructure);


    function setupDir(inDir, spec) {
        Object.getOwnPropertyNames(spec)
            .forEach(name => {
                let value = spec[name];
                let newPath = path.join(inDir, name);
                if (typeof value === 'object') {
                    fs.emptyDirSync(newPath);
                    setupDir(newPath, value);
                } else if (value.indexOf('>>') === 0) {
                    fs.symlinkSync(path.join(inDir, value.substr(2)), newPath);
                } else {
                    fs.writeFileSync(newPath, value);
                }
            });
    }

}