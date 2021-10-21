const fs = require('fs');
const path = require('path');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const SRC_PATH = './source';
const GAP_PATH = './gap';
const TMP_PATH = './tmp';
const OUTPUT_PATH = './output';
const regexFileName = /([0-9]*)-([0-9]*)/;

let srcFiles = getListFile(SRC_PATH, false);
let gapFiles = getListFile(GAP_PATH, true);
let segments = [];

main();

function main() {
    srcFiles = sortItems(srcFiles);
    segments = getSegments();
    console.log(segments);
    // handleVideos(segments);
}

function sortItems(array) {
    let isOrdered;
    for (let i = 0; i < array.length; i++) {
        isOrdered = true;
        for (let x = 0; x < array.length - 1 - i; x++) {
            if (array[x].startAt > array[x + 1].startAt) {
                [array[x], array[x + 1]] = [array[x + 1], array[x]];
                isOrdered = false;
            }
        }
        if (isOrdered) break;
    }
    return array;
}

function getGapFile(srcFile) {
    let tmp = gapFiles;
    for (let index = 0; index < tmp.length; index++) {
        const gapFile = tmp[index];
        if (srcFile.endAt >= gapFile.startAt) {
            tmp = tmp.splice(index, 1);
            return gapFile;
        }
    }
}

function getSegments() {
    let segmentTmp = [];
    for (const srcFile of srcFiles) {
        segmentTmp.push(srcFile);
        let gapFile = getGapFile(srcFile);
        if (gapFile) {
            segmentTmp.push(gapFile);
        }
    }

    const result = [];
    for (let index = 0; index < segmentTmp.length; index++) {
        const prevFile = segmentTmp[index - 1];
        let currFile = segmentTmp[index];
        const nextFile = segmentTmp[index + 1];
        if (currFile.isGap) {
            let gapTime = getGapTime(prevFile, currFile, nextFile);
            currFile = { ...currFile, ...gapTime };
            if (currFile.endAt < nextFile.startAt) { // gap file hết trước khi bắt đầu file kế tiếp
                return new Error(`File không đủ thời gian\nSource file: ${prevFile.path}\nGap file: ${currFile.path}\nSource file: ${nextFile.path}`);
            }
        } else {
            currFile = {
                ...currFile,
                gapStartTime: 0,
                gapDuration: currFile.duration
            }
        }
        result.push(currFile);
    }

    return result;
}

function getListFile(folder, isGap) {
    const tmp = [];
    fs.readdirSync(folder).forEach(file => {
        let name = path.basename(file, path.extname(file));
        if (name.match(regexFileName)) {
            let ext = path.extname(file);
            let time = name.split('-');
            let startAt = +time[0];
            let endAt = +time[1];
            let duration = endAt - startAt;
            tmp.push({
                path: `${folder}/${file}`,
                name: name,
                ext: ext,
                startAt: startAt,
                endAt: endAt,
                duration: duration,
                isGap: isGap
            });
        }
    });

    return tmp;
}

function getGapTime(prevFile, currFile, nextFile) {
    let gapStartTime = 0;
    let gapDuration = currFile.duration;
    if (prevFile) {
        gapStartTime = Math.abs(prevFile.endAt - currFile.startAt);
    }

    if (nextFile) {
        gapDuration = Math.abs(currFile.endAt - nextFile.startAt);
    }

    if (prevFile && nextFile) {
        gapDuration = Math.abs(nextFile.startAt - prevFile.endAt);
    }

    return {
        gapStartTime: gapStartTime,
        gapDuration: gapDuration
    }
}

async function handleVideos(videos) {
    let outputVideos = [];
    for (const video of videos) {
        if (video.isGap) {
            let tmpPath = `${TMP_PATH}/${video.name}${video.ext}`;
            outputVideos.push(tmpPath);
            await trimVideo(video, tmpPath);
        } else {
            outputVideos.push(`${video.path}`);
        }
    }
    concatVideo(outputVideos);
}

async function trimVideo(file, outputPath) {
    return new Promise((resolve, reject) => {
        const cmd = ffmpeg({ source: file.path });
        cmd.setStartTime(file.gapStartTime)
            .setDuration(file.gapDuration)
            .on('start', function (cmdline) {
                console.log('Command line: ' + cmdline);
            })
            .on("error", function (err) {
                console.log("error: ", +err);
                return reject(new Error(err));
            })
            .on("end", function (data) {
                console.log('Trim done!')
                resolve()
            })
            .saveToFile(outputPath);
    })
}

async function transcodeVideo(videoPaths) {
    let outputFiles = [];
    let i = 0;
    for (let inputFile of videoPaths) {
        let outputFile = `${TMP_PATH}/${i}.mp4`;
        outputFiles.push(outputFile);
        await formatVideo(inputFile, outputFile);
        i++;
    };

    console.log('Format done!')
    return outputFiles;
}

async function formatVideo(inputFile, outputFile) {
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg()
            .on('start', function (cmdline) {
                console.log('Command line: ' + cmdline);
            })
            .on('progress', function (progress) {
                console.info(`Processing transcode ${outputFile}: ${progress.percent} % done`);
            })
            .on("error", function (err) {
                return reject(new Error(err));
            })
            .on("end", function (data) {
                resolve()
            })
            .input(inputFile)
            .output(outputFile)
            .videoCodec('copy')
            .audioCodec('copy')
            .run();
    })
}

async function concatVideo(videoPaths) {
    // let transcodedVideos = await transcodeVideo(videoPaths);
    let transcodedVideos = videoPaths;
    console.log(transcodedVideos);
    let cmd = ffmpeg();
    transcodedVideos.forEach(function (transcodedVideo) {
        cmd = cmd.addInput(transcodedVideo);
    });
    cmd.on('start', function (cmdline) {
            console.log('Command line: ' + cmdline);
        })
        .on('progress', function (progress) {
            console.info(`Processing: ${progress.percent} % done`);
        })
        .on('end', function () {
            console.log('Merge done');
        })
        .on('error', function (error) {
            console.info('Merge error', error);
        })
        .mergeToFile(`${OUTPUT_PATH}/output.mp4`);
}