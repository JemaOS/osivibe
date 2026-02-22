const fs = require('fs');

const content = fs.readFileSync('src/utils/ffmpeg.ts', 'utf8');

const startIndex = content.indexOf('async function _exportProjectInternal(');
const endIndex = content.indexOf('function getFileExtension(filename: string): string {');

if (startIndex === -1 || endIndex === -1) {
  console.error('Could not find start or end index');
  process.exit(1);
}

const helpers = `
type ExportClip = { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; filter?: VideoFilter; id?: string; audioMuted?: boolean };
type ExportAudioClip = { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; id?: string };

async function exportSingleClipFastPath(
  ffmpegInstance: any,
  clip: ExportClip,
  clipDuration: number,
  inputFileName: string,
  outputFileName: string,
  resolution: { width: number; height: number },
  effectiveFps: number,
  encodingSettings: any,
  quality: string,
  outputFormat: string,
  execTimeoutMs: number,
  textOverlays?: any[],
  onProgress?: (progress: number, message: string) => void
) {
  let videoFilterChain = \`scale=\${resolution.width}:\${resolution.height}:force_original_aspect_ratio=decrease,pad=\${resolution.width}:\${resolution.height}:(ow-iw)/2:(oh-ih)/2\`;

  if (clip.filter) {
    const filterString = getFilterString(clip.filter);
    if (filterString) {
      videoFilterChain += ',' + filterString;
    }
  }

  if (textOverlays && textOverlays.length > 0) {
    const relevantTexts = textOverlays.filter((text) => {
      const textEnd = text.startTime + text.duration;
      return text.text.trim() && text.startTime < clipDuration && textEnd > 0;
    });

    for (const text of relevantTexts) {
      const adjustedText = {
        ...text,
        startTime: Math.max(0, text.startTime - clip.trimStart),
        duration: text.duration,
      };

      const endTime = adjustedText.startTime + adjustedText.duration;
      if (endTime > clipDuration) {
        adjustedText.duration = clipDuration - adjustedText.startTime;
      }

      if (adjustedText.duration > 0) {
        const textFilter = getTextFilterString(adjustedText, resolution.width, resolution.height);
        videoFilterChain += ',' + textFilter;
      }
    }
  }

  let args = [
    '-i', inputFileName,
    '-ss', clip.trimStart.toString(),
    '-t', clipDuration.toString(),
    '-vf', videoFilterChain,
    '-c:v', encodingSettings.videoCodec,
    '-crf', quality,
    '-c:a', outputFormat === 'webm' ? 'libopus' : 'aac',
    '-preset', encodingSettings.preset,
    '-r', String(effectiveFps),
    '-pix_fmt', encodingSettings.pixelFormat,
    '-threads', encodingSettings.threads,
    outputFileName
  ];

  args = buildOptimizedArgs(args, encodingSettings);

  console.log('FFmpeg command:', args.join(' '));
  await execWithTimeout(ffmpegInstance, args, execTimeoutMs);
  
  onProgress?.(96, 'Finalisation...');
}

async function exportSingleClipComplexPath(
  ffmpegInstance: any,
  clip: ExportClip,
  clipDuration: number,
  inputFileName: string,
  outputFileName: string,
  resolution: { width: number; height: number },
  effectiveFps: number,
  encodingSettings: any,
  quality: string,
  outputFormat: string,
  execTimeoutMs: number,
  clipTransitions: any[],
  externalAudioClipsSingle: any[],
  timeOriginSingle: number,
  safeMode: boolean,
  textOverlays?: any[],
  onProgress?: (progress: number, message: string) => void
) {
  const startTransition = clipTransitions.find((t) => t.position === 'start');
  const endTransition = clipTransitions.find((t) => t.position === 'end');
  const needsBg = clipTransitions.length > 0;

  const extraAudioFiles: File[] = [];
  for (const ac of externalAudioClipsSingle) {
    if (ac.file === clip.file) continue;
    if (!extraAudioFiles.includes(ac.file)) extraAudioFiles.push(ac.file);
  }

  const extraAudioInputNames: string[] = [];
  for (let i = 0; i < extraAudioFiles.length; i++) {
    const file = extraAudioFiles[i];
    const name = \`audio_input\${i}\${getFileExtension(file.name)}\`;
    extraAudioInputNames.push(name);
    try {
      await ffmpegInstance.deleteFile(name);
    } catch {}
    const buf = new Uint8Array(await file.arrayBuffer());
    await writeFileWithTimeout(ffmpegInstance, name, buf, safeMode ? 60000 : 45000);
  }

  const bgInputIndex = 1 + extraAudioInputNames.length;
  const fc: string[] = [];

  let vBase = \`[0:v]trim=start=\${clip.trimStart}:duration=\${clipDuration},setpts=PTS-STARTPTS,scale=\${resolution.width}:\${resolution.height}:force_original_aspect_ratio=decrease,pad=\${resolution.width}:\${resolution.height}:(ow-iw)/2:(oh-ih)/2,fps=\${effectiveFps}\`;
  if (clip.filter) {
    const filterString = getFilterString(clip.filter);
    if (filterString) vBase += \`,\${filterString}\`;
  }
  fc.push(\`\${vBase}[v0]\`);

  if (needsBg) {
    fc.push(\`[\${bgInputIndex}:v]setpts=PTS-STARTPTS[bg]\`);
  }

  if (externalAudioClipsSingle.length > 0) {
    const sortedAudio = [...externalAudioClipsSingle].sort((a, b) => a.startTime - b.startTime);
    const parts: string[] = [];
    let cursor = 0;
    let seg = 0;

    for (const ac of sortedAudio) {
      const dur = Math.max(0, ac.duration - ac.trimStart - ac.trimEnd);
      if (dur <= 0.001) continue;

      const requestedStart = Math.max(0, ac.startTime - timeOriginSingle);
      const start = Math.max(requestedStart, cursor);
      const gap = start - cursor;
      if (gap > 0.01) {
        const gl = \`agap0_\${seg++}\`;
        fc.push(\`aevalsrc=0:d=\${gap}:s=48000:c=stereo[\${gl}]\`);
        parts.push(\`[\${gl}]\`);
        cursor += gap;
      }

      const inputIndex = ac.file === clip.file ? 0 : 1 + extraAudioFiles.findIndex((f) => f === ac.file);
      const al = \`aext0_\${seg++}\`;
      fc.push(\`[\${inputIndex}:a]atrim=start=\${ac.trimStart}:duration=\${dur},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[\${al}]\`);
      parts.push(\`[\${al}]\`);
      cursor += dur;
    }

    const tail = clipDuration - cursor;
    if (tail > 0.01) {
      const tl = \`atail0_\${seg++}\`;
      fc.push(\`aevalsrc=0:d=\${tail}:s=48000:c=stereo[\${tl}]\`);
      parts.push(\`[\${tl}]\`);
    }

    if (parts.length === 0) {
      fc.push(\`aevalsrc=0:d=\${clipDuration}:s=48000:c=stereo[a0]\`);
    } else {
      fc.push(\`\${parts.join('')}concat=n=\${parts.length}:v=0:a=1[a0]\`);
    }
  } else if (clip.audioMuted) {
    fc.push(\`aevalsrc=0:d=\${clipDuration}:s=48000:c=stereo[a0]\`);
  } else {
    fc.push(\`[0:a]atrim=start=\${clip.trimStart}:duration=\${clipDuration},asetpts=PTS-STARTPTS[a0]\`);
  }

  let vLabel = 'v0';
  if (needsBg && startTransition && startTransition.type !== 'none') {
    const d = Math.max(0.1, Math.min(startTransition.duration, clipDuration * 0.5));
    const transName = mapTransitionTypeToFFmpeg(startTransition.type);
    fc.push(\`[bg][\${vLabel}]xfade=transition=\${transName}:duration=\${d}:offset=0[vstart]\`);
    vLabel = 'vstart';
  }

  if (needsBg && endTransition && endTransition.type !== 'none') {
    const d = Math.max(0.1, Math.min(endTransition.duration, clipDuration * 0.5));
    const st = Math.max(0, clipDuration - d);
    const transName = mapTransitionTypeToFFmpeg(endTransition.type);
    fc.push(\`[\${vLabel}][bg]xfade=transition=\${transName}:duration=\${d}:offset=\${st}[vend]\`);
    vLabel = 'vend';
  }

  if (textOverlays && textOverlays.length > 0 && textOverlays.some((t) => t.text.trim())) {
    const validTexts = textOverlays.filter((t) => t.text.trim());
    let inV = vLabel;
    for (let i = 0; i < validTexts.length; i++) {
      const text = validTexts[i];
      const textFilter = getTextFilterString(text, resolution.width, resolution.height);
      const outV = i === validTexts.length - 1 ? 'vfinal' : \`vtext\${i}\`;
      fc.push(\`[\${inV}]\${textFilter}[\${outV}]\`);
      inV = outV;
    }
    vLabel = 'vfinal';
  }

  const baseArgs: string[] = ['-i', inputFileName];
  for (const n of extraAudioInputNames) baseArgs.push('-i', n);
  if (needsBg) {
    const bgLavfi = \`color=c=black:s=\${resolution.width}x\${resolution.height}:r=\${effectiveFps}:d=\${clipDuration}\`;
    baseArgs.push('-f', 'lavfi', '-i', bgLavfi);
  }

  let args = [
    ...baseArgs,
    '-progress', 'pipe:1',
    '-nostats',
    '-filter_complex', fc.join(';'),
    '-map', \`[\${vLabel}]\`,
    '-map', '[a0]',
    '-c:v', encodingSettings.videoCodec,
    '-crf', quality,
    '-c:a', outputFormat === 'webm' ? 'libopus' : 'aac',
    '-preset', encodingSettings.preset,
    '-r', String(effectiveFps),
    '-pix_fmt', encodingSettings.pixelFormat,
    '-threads', encodingSettings.threads,
    '-shortest',
    outputFileName
  ];

  args = buildOptimizedArgs(args, encodingSettings);
  console.log('FFmpeg command:', args.join(' '));
  await execWithTimeout(ffmpegInstance, args, execTimeoutMs);
  
  onProgress?.(96, 'Finalisation...');

  for (const n of extraAudioInputNames) {
    try {
      await ffmpegInstance.deleteFile(n);
    } catch {}
  }
}

async function exportSingleClip(
  ffmpegInstance: any,
  clip: ExportClip,
  settings: any,
  encodingSettings: any,
  resolution: { width: number; height: number },
  outputFormat: string,
  quality: string,
  execTimeoutMs: number,
  encodingStartTime: number,
  onProgress?: (progress: number, message: string) => void,
  textOverlays?: any[],
  transitions?: any[],
  audioClips?: any[],
  safeMode: boolean = false
): Promise<Blob> {
  onProgress?.(5, 'Chargement du fichier...');
  const inputFileName = 'input' + getFileExtension(clip.file.name);
  const outputFileName = \`output.\${outputFormat}\`;

  const fileData = await fetchFile(clip.file);
  
  try {
    await ffmpegInstance.deleteFile(inputFileName);
  } catch (e) {}

  const dataArray = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);
  await writeFileWithTimeout(ffmpegInstance, inputFileName, dataArray);

  onProgress?.(5, 'Traitement de la vidéo...');

  const clipDuration = clip.duration - clip.trimStart - clip.trimEnd;
  const requestedFps = parseInt(settings.fps || '30', 10);
  const effectiveFps = Math.min(requestedFps, encodingSettings.targetFps);

  const externalAudioClipsSingle = (audioClips || []).filter((c) => isLikelyAudioFile(c.file));
  const timeOriginSingle = clip.startTime;

  const clipId = clip.id;
  const clipTransitions = (transitions || []).filter((t) => t.clipId === clipId && t.type !== 'none');
  const hasClipTransitions = clipTransitions.length > 0;

  if (!hasClipTransitions && externalAudioClipsSingle.length === 0 && !clip.audioMuted) {
    await exportSingleClipFastPath(
      ffmpegInstance, clip, clipDuration, inputFileName, outputFileName,
      resolution, effectiveFps, encodingSettings, quality, outputFormat,
      execTimeoutMs, textOverlays, onProgress
    );
  } else {
    await exportSingleClipComplexPath(
      ffmpegInstance, clip, clipDuration, inputFileName, outputFileName,
      resolution, effectiveFps, encodingSettings, quality, outputFormat,
      execTimeoutMs, clipTransitions, externalAudioClipsSingle, timeOriginSingle,
      safeMode, textOverlays, onProgress
    );
  }

  onProgress?.(98, 'Finalisation...');
  const data = await ffmpegInstance.readFile(outputFileName);
  
  await ffmpegInstance.deleteFile(inputFileName);
  await ffmpegInstance.deleteFile(outputFileName);

  const actualEncodingTime = (performance.now() - encodingStartTime) / 1000;
  console.log('✅ EXPORT COMPLETE (Single Clip)');
  console.log(\`⏱️ Actual encoding time: \${formatEncodingTime(Math.ceil(actualEncodingTime))}\`);
  console.log(\`📈 Speed ratio: \${(currentTotalDuration / actualEncodingTime).toFixed(2)}x realtime\`);

  onProgress?.(100, 'Terminé !');
  return new Blob([data as any], { type: outputFormat === 'webm' ? 'video/webm' : 'video/mp4' });
}

interface GapInfo {
  beforeClipIndex: number;
  duration: number;
}

function detectGaps(clips: ExportClip[]): { gaps: GapInfo[], gapMap: Map<number, number> } {
  const gaps: GapInfo[] = [];
  const gapMap = new Map<number, number>();
  
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const clipStartTime = clip.startTime;
    
    if (i > 0) {
      const prevClip = clips[i - 1];
      const prevEffectiveDuration = prevClip.duration - prevClip.trimStart - prevClip.trimEnd;
      const expectedStartTime = prevClip.startTime + prevEffectiveDuration;
      const gapDuration = clipStartTime - expectedStartTime;
      if (gapDuration > 0.01) {
        gaps.push({ beforeClipIndex: i, duration: gapDuration });
        gapMap.set(i, gapDuration);
      }
    }
  }
  return { gaps, gapMap };
}

async function loadUniqueFiles(
  ffmpegInstance: any,
  clips: ExportClip[],
  safeMode: boolean,
  onProgress?: (progress: number, message: string) => void
) {
  const inputFiles: string[] = [];
  const clipToInputIndex = new Map<number, number>();
  const uniqueFiles: { file: File; originalIndex: number }[] = [];
  
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    clipToInputIndex.set(i, uniqueFiles.length);
    uniqueFiles.push({ file: clip.file, originalIndex: i });
  }
  
  const inputVideoMeta = new Map<number, { width: number; height: number }>();
  
  for (let i = 0; i < uniqueFiles.length; i++) {
    const { file } = uniqueFiles[i];
    const inputFileName = \`input\${i}\${getFileExtension(file.name)}\`;
    inputFiles.push(inputFileName);

    if (file.type.startsWith('video/')) {
      try {
        const meta = await getVideoMetadata(file);
        inputVideoMeta.set(i, { width: meta.width, height: meta.height });
      } catch {}
    }
    
    onProgress?.(5, \`Chargement des fichiers... (\${i + 1}/\${uniqueFiles.length})\`);

    const arrayBuffer = await file.arrayBuffer();
    const dataArray = new Uint8Array(arrayBuffer);
    
    try {
      await ffmpegInstance.deleteFile(inputFileName);
    } catch (e) {}
    
    await writeFileWithTimeout(ffmpegInstance, inputFileName, dataArray, safeMode ? 60000 : 45000);
  }
  
  return { inputFiles, clipToInputIndex, uniqueFiles, inputVideoMeta };
}

async function loadExternalAudioFiles(
  ffmpegInstance: any,
  externalAudioClips: ExportAudioClip[],
  uniqueFiles: { file: File; originalIndex: number }[],
  inputFiles: string[],
  safeMode: boolean,
  onProgress?: (progress: number, message: string) => void
) {
  const externalAudioFileToInputIndex = new Map<File, number>();
  const extraAudioFiles: File[] = [];

  for (const ac of externalAudioClips) {
    const f = ac.file;
    const existingVideoIdx = uniqueFiles.findIndex((u) => u.file === f);
    if (existingVideoIdx !== -1) {
      externalAudioFileToInputIndex.set(f, existingVideoIdx);
      continue;
    }
    if (!extraAudioFiles.includes(f)) extraAudioFiles.push(f);
  }

  for (let i = 0; i < extraAudioFiles.length; i++) {
    const file = extraAudioFiles[i];
    const inputIndex = uniqueFiles.length + i;
    externalAudioFileToInputIndex.set(file, inputIndex);

    const inputFileName = \`audio_input\${i}\${getFileExtension(file.name)}\`;
    inputFiles.push(inputFileName);

    onProgress?.(5, \`Chargement des fichiers audio... (\${i + 1}/\${extraAudioFiles.length})\`);
    try {
      await ffmpegInstance.deleteFile(inputFileName);
    } catch {}
    const dataArray = new Uint8Array(await file.arrayBuffer());
    await writeFileWithTimeout(ffmpegInstance, inputFileName, dataArray, safeMode ? 60000 : 45000);
  }
  
  return externalAudioFileToInputIndex;
}

function buildMultiClipFilterChain(
  clips: ExportClip[],
  gaps: GapInfo[],
  gapMap: Map<number, number>,
  clipToInputIndex: Map<number, number>,
  inputVideoMeta: Map<number, { width: number; height: number }>,
  transitions: any[] | undefined,
  textOverlays: any[] | undefined,
  externalAudioClips: ExportAudioClip[],
  externalAudioFileToInputIndex: Map<File, number>,
  resolution: { width: number; height: number },
  targetFps: number,
  timeOrigin: number,
  uniqueFilesCount: number
) {
  const filterComplex: string[] = [];
  
  const hasImages = clips.some((c) => c.file.type.startsWith('image/'));
  const hasAnyTransitionMarkers = !!(transitions && transitions.some((t) => t.type !== 'none'));
  const needsPerClipTimebaseNormalization = hasAnyTransitionMarkers;
  const needsFpsNormalization = uniqueFilesCount > 1 || hasImages || needsPerClipTimebaseNormalization;
  
  let gapCounter = 0;
  for (const gap of gaps) {
    const gapVideoLabel = \`vgap\${gapCounter}\`;
    const gapAudioLabel = \`agap\${gapCounter}\`;
    filterComplex.push(\`color=c=black:s=\${resolution.width}x\${resolution.height}:d=\${gap.duration}:r=\${targetFps},format=yuv420p[\${gapVideoLabel}]\`);
    filterComplex.push(\`aevalsrc=0:d=\${gap.duration}:s=48000:c=stereo[\${gapAudioLabel}]\`);
    gapCounter++;
  }
  
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const inputIndex = clipToInputIndex.get(i) ?? i;
    const isImage = clip.file.type.startsWith('image/');
    const duration = clip.duration - clip.trimStart - clip.trimEnd;

    const meta = inputVideoMeta.get(inputIndex);
    const needsScalePad = !isImage && meta ? (meta.width !== resolution.width || meta.height !== resolution.height) : true;
    
    let videoFilter = '';
    if (isImage) {
      videoFilter = \`[\${inputIndex}:v]loop=loop=-1:size=1:start=0,trim=duration=\${duration},setpts=PTS-STARTPTS,scale=\${resolution.width}:\${resolution.height}:force_original_aspect_ratio=decrease,pad=\${resolution.width}:\${resolution.height}:(ow-iw)/2:(oh-ih)/2\`;

      if (needsFpsNormalization) videoFilter += \`,fps=\${targetFps}\`;
      if (needsPerClipTimebaseNormalization) videoFilter += \`,settb=1/\${targetFps}\`;
    } else {
      videoFilter = \`[\${inputIndex}:v]trim=start=\${clip.trimStart}:duration=\${duration},setpts=PTS-STARTPTS\`;

      if (needsScalePad) {
        videoFilter += \`,scale=\${resolution.width}:\${resolution.height}:force_original_aspect_ratio=decrease,pad=\${resolution.width}:\${resolution.height}:(ow-iw)/2:(oh-ih)/2\`;
      }

      if (needsFpsNormalization) videoFilter += \`,fps=\${targetFps}\`;
      if (needsPerClipTimebaseNormalization) videoFilter += \`,settb=1/\${targetFps}\`;
    }
    
    if (clip.filter) {
      const filterString = getFilterString(clip.filter);
      if (filterString) videoFilter += ',' + filterString;
    }
    
    filterComplex.push(\`\${videoFilter}[v\${i}]\`);
    
    if (isImage) {
      filterComplex.push(\`aevalsrc=0:d=\${duration}:s=48000:c=stereo[a\${i}]\`);
    } else {
      if (clip.audioMuted) {
        filterComplex.push(\`aevalsrc=0:d=\${duration}:s=48000:c=stereo[a\${i}]\`);
      } else {
        filterComplex.push(\`[\${inputIndex}:a]atrim=start=\${clip.trimStart}:duration=\${duration},asetpts=PTS-STARTPTS[a\${i}]\`);
      }
    }
  }
  
  const clipDurations: number[] = clips.map(clip => clip.duration - clip.trimStart - clip.trimEnd);
  
  const clipIdToSortedIndex = new Map<string, number>();
  clips.forEach((clip, index) => {
    if (clip.id) clipIdToSortedIndex.set(clip.id, index);
  });
  
  const startTransitionByIndex = new Map<number, any>();
  const endTransitionByIndex = new Map<number, any>();
  
  if (transitions && transitions.length > 0) {
    for (const transition of transitions) {
      const sortedIndex = clipIdToSortedIndex.get(transition.clipId);
      if (transition.type !== 'none' && sortedIndex !== undefined) {
        if (transition.position === 'start') {
          startTransitionByIndex.set(sortedIndex, transition);
        } else if (transition.position === 'end') {
          endTransitionByIndex.set(sortedIndex, transition);
        }
      }
    }
  }
  
  const hasAnyTransitions = startTransitionByIndex.size > 0 || endTransitionByIndex.size > 0;
  let currentVideoLabel = '';
  
  if (!hasAnyTransitions && clips.length > 1) {
    const orderedVideoLabels: string[] = [];
    const orderedAudioLabels: string[] = [];
    let gapIdx = 0;

    for (let i = 0; i < clips.length; i++) {
      if (gapMap.has(i)) {
        orderedVideoLabels.push(\`[vgap\${gapIdx}]\`);
        orderedAudioLabels.push(\`[agap\${gapIdx}]\`);
        gapIdx++;
      }
      orderedVideoLabels.push(\`[v\${i}]\`);
      orderedAudioLabels.push(\`[a\${i}]\`);
    }

    filterComplex.push(\`\${orderedVideoLabels.join('')}concat=n=\${orderedVideoLabels.length}:v=1:a=0[outv]\`);
    filterComplex.push(\`\${orderedAudioLabels.join('')}concat=n=\${orderedAudioLabels.length}:v=0:a=1[outa]\`);
    currentVideoLabel = 'outv';
  } else if (hasAnyTransitions) {
    const isAdjacentToNext: boolean[] = [];
    for (let i = 0; i < clips.length - 1; i++) {
      isAdjacentToNext.push(!gapMap.has(i + 1));
    }
    isAdjacentToNext.push(false);
    
    const allVideoSegments: string[] = [];
    const allAudioSegments: string[] = [];
    
    let gapIdx = 0;
    for (let i = 0; i < clips.length; i++) {
      if (gapMap.has(i)) {
        allVideoSegments.push(\`vgap\${gapIdx}\`);
        allAudioSegments.push(\`agap\${gapIdx}\`);
        gapIdx++;
      }
      allVideoSegments.push(\`v\${i}\`);
      allAudioSegments.push(\`a\${i}\`);
    }
    
    let needsXfade = false;
    for (let i = 0; i < clips.length - 1; i++) {
      if (isAdjacentToNext[i]) {
        const transition = startTransitionByIndex.get(i + 1) || endTransitionByIndex.get(i);
        if (transition && transition.type !== 'none') {
          needsXfade = true;
          break;
        }
      }
    }
    
    if (!needsXfade) {
      const allVideoLabelsStr = allVideoSegments.map(s => \`[\${s}]\`).join('');
      const allAudioLabelsStr = allAudioSegments.map(s => \`[\${s}]\`).join('');
      filterComplex.push(\`\${allVideoLabelsStr}concat=n=\${allVideoSegments.length}:v=1:a=0[outv]\`);
      filterComplex.push(\`\${allAudioLabelsStr}concat=n=\${allAudioSegments.length}:v=0:a=1[outa]\`);
      currentVideoLabel = 'outv';
    } else {
      let mergeCounter = 0;
      const processedVideoSegments: string[] = [];
      const processedAudioSegments: string[] = [];
      const processedClips = new Set<number>();
      
      if (gapMap.has(0)) {
        processedVideoSegments.push('vgap0');
        processedAudioSegments.push('agap0');
      }
      
      for (let i = 0; i < clips.length; i++) {
        if (processedClips.has(i)) continue;
        
        let currentGroupLabel = \`v\${i}\`;
        let groupEndIndex = i;
        let groupCumulativeOffset = clipDurations[i];
        const clipIndicesInGroup: number[] = [i];
        
        while (groupEndIndex < clips.length - 1 && isAdjacentToNext[groupEndIndex]) {
          const nextIndex = groupEndIndex + 1;
          const transition = startTransitionByIndex.get(nextIndex) || endTransitionByIndex.get(groupEndIndex);
          
          if (transition && transition.type !== 'none') {
            const transitionDuration = Math.min(
              transition.duration,
              clipDurations[groupEndIndex] * 0.9,
              clipDurations[nextIndex] * 0.9
            );
            const offset = Math.max(0, groupCumulativeOffset - transitionDuration);
            const outputLabel = \`vm\${mergeCounter}\`;

            const xfadeFilter = getTransitionFilter(transition, offset);
            
            if (xfadeFilter) {
              filterComplex.push(\`[\${currentGroupLabel}][v\${nextIndex}]\${xfadeFilter},settb=1/\${targetFps}[\${outputLabel}]\`);
              currentGroupLabel = outputLabel;
              mergeCounter++;
              groupCumulativeOffset = offset + clipDurations[nextIndex];
            }
            
            processedClips.add(nextIndex);
            clipIndicesInGroup.push(nextIndex);
            groupEndIndex = nextIndex;
          } else {
            const outputLabel = \`vm\${mergeCounter}\`;
            filterComplex.push(\`[\${currentGroupLabel}][v\${nextIndex}]concat=n=2:v=1:a=0,settb=1/\${targetFps}[\${outputLabel}]\`);
            currentGroupLabel = outputLabel;
            mergeCounter++;
            groupCumulativeOffset += clipDurations[nextIndex];
            
            processedClips.add(nextIndex);
            clipIndicesInGroup.push(nextIndex);
            groupEndIndex = nextIndex;
          }
        }
        
        processedVideoSegments.push(currentGroupLabel);
        
        if (clipIndicesInGroup.length > 1) {
          const audioLabels = clipIndicesInGroup.map(ci => \`[a\${ci}]\`).join('');
          const mergedAudioLabel = \`am\${mergeCounter}\`;
          filterComplex.push(\`\${audioLabels}concat=n=\${clipIndicesInGroup.length}:v=0:a=1[\${mergedAudioLabel}]\`);
          processedAudioSegments.push(mergedAudioLabel);
        } else {
          processedAudioSegments.push(\`a\${i}\`);
        }
        
        let nextUnprocessedIndex = groupEndIndex + 1;
        while (nextUnprocessedIndex < clips.length && processedClips.has(nextUnprocessedIndex)) {
          nextUnprocessedIndex++;
        }
        
        if (nextUnprocessedIndex < clips.length && gapMap.has(nextUnprocessedIndex)) {
          let actualGapIndex = 0;
          for (const gap of gaps) {
            if (gap.beforeClipIndex === nextUnprocessedIndex) {
              processedVideoSegments.push(\`vgap\${actualGapIndex}\`);
              processedAudioSegments.push(\`agap\${actualGapIndex}\`);
              break;
            }
            actualGapIndex++;
          }
        }
      }
      
      if (processedVideoSegments.length === 1) {
        filterComplex.push(\`[\${processedVideoSegments[0]}]null[outv]\`);
      } else {
        const allLabels = processedVideoSegments.map(s => \`[\${s}]\`).join('');
        filterComplex.push(\`\${allLabels}concat=n=\${processedVideoSegments.length}:v=1:a=0,settb=1/\${targetFps}[outv]\`);
      }
      
      if (processedAudioSegments.length === 1) {
        filterComplex.push(\`[\${processedAudioSegments[0]}]anull[outa]\`);
      } else {
        const allAudioLabels = processedAudioSegments.map(s => \`[\${s}]\`).join('');
        filterComplex.push(\`\${allAudioLabels}concat=n=\${processedAudioSegments.length}:v=0:a=1[outa]\`);
      }
      
      currentVideoLabel = 'outv';
    }
  }
  
  if (textOverlays && textOverlays.length > 0 && textOverlays.some(t => t.text.trim())) {
    let textInputLabel = currentVideoLabel;
    let textOutputLabel = 'vtext0';
    
    const validTexts = textOverlays.filter(t => t.text.trim());
    
    for (let i = 0; i < validTexts.length; i++) {
      const text = validTexts[i];
      const textFilter = getTextFilterString(text, resolution.width, resolution.height);
      const isLast = i === validTexts.length - 1;
      textOutputLabel = isLast ? 'finalv' : \`vtext\${i}\`;
      
      filterComplex.push(\`[\${textInputLabel}]\${textFilter}[\${textOutputLabel}]\`);
      textInputLabel = textOutputLabel;
    }
    
    currentVideoLabel = 'finalv';
  }

  const finalVideoLabel = currentVideoLabel;
  const finalAudioLabel = externalAudioClips.length > 0 ? 'outa_ext' : 'outa';

  if (externalAudioClips.length > 0) {
    const outputTimelineDuration = Math.max(
      0,
      ...clips.map((c) => {
        const d = c.duration - c.trimStart - c.trimEnd;
        return Math.max(0, c.startTime - timeOrigin) + Math.max(0, d);
      })
    );

    const sortedAudio = [...externalAudioClips].sort((a, b) => a.startTime - b.startTime);
    const parts: string[] = [];
    let cursor = 0;
    let seg = 0;

    for (const ac of sortedAudio) {
      const inputIndex = externalAudioFileToInputIndex.get(ac.file);
      if (inputIndex == null) continue;

      const dur = Math.max(0, ac.duration - ac.trimStart - ac.trimEnd);
      if (dur <= 0.001) continue;

      const requestedStart = Math.max(0, ac.startTime - timeOrigin);
      const start = Math.max(requestedStart, cursor);
      const gap = start - cursor;
      if (gap > 0.01) {
        const gl = \`agape\${seg++}\`;
        filterComplex.push(\`aevalsrc=0:d=\${gap}:s=48000:c=stereo[\${gl}]\`);
        parts.push(\`[\${gl}]\`);
        cursor += gap;
      }

      const al = \`aext\${seg++}\`;
      filterComplex.push(\`[\${inputIndex}:a]atrim=start=\${ac.trimStart}:duration=\${dur},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[\${al}]\`);
      parts.push(\`[\${al}]\`);
      cursor += dur;
    }

    const tail = outputTimelineDuration - cursor;
    if (tail > 0.01) {
      const tl = \`atail\${seg++}\`;
      filterComplex.push(\`aevalsrc=0:d=\${tail}:s=48000:c=stereo[\${tl}]\`);
      parts.push(\`[\${tl}]\`);
    }

    if (parts.length === 0) {
      filterComplex.push(\`aevalsrc=0:d=\${outputTimelineDuration}:s=48000:c=stereo[\${finalAudioLabel}]\`);
    } else {
      filterComplex.push(\`\${parts.join('')}concat=n=\${parts.length}:v=0:a=1[\${finalAudioLabel}]\`);
    }
  }

  return { filterComplex, finalVideoLabel, finalAudioLabel };
}

async function exportMultiClip(
  ffmpegInstance: any,
  clips: ExportClip[],
  settings: any,
  encodingSettings: any,
  resolution: { width: number; height: number },
  outputFormat: string,
  quality: string,
  execTimeoutMs: number,
  encodingStartTime: number,
  onProgress?: (progress: number, message: string) => void,
  textOverlays?: any[],
  transitions?: any[],
  audioClips?: ExportAudioClip[],
  safeMode: boolean = false
): Promise<Blob> {
  onProgress?.(5, 'Chargement des fichiers...');
  
  const externalAudioClips = (audioClips || []).filter((c) => isLikelyAudioFile(c.file));
  const timeOrigin = clips.length > 0 ? Math.min(...clips.map((c) => c.startTime)) : 0;
  
  const { gaps, gapMap } = detectGaps(clips);
  
  const { inputFiles, clipToInputIndex, uniqueFiles, inputVideoMeta } = await loadUniqueFiles(
    ffmpegInstance, clips, safeMode, onProgress
  );
  
  const externalAudioFileToInputIndex = await loadExternalAudioFiles(
    ffmpegInstance, externalAudioClips, uniqueFiles, inputFiles, safeMode, onProgress
  );
  
  const targetFps = parseInt(settings.fps || '30');
  
  const { filterComplex, finalVideoLabel, finalAudioLabel } = buildMultiClipFilterChain(
    clips, gaps, gapMap, clipToInputIndex, inputVideoMeta, transitions, textOverlays,
    externalAudioClips, externalAudioFileToInputIndex, resolution, targetFps, timeOrigin, uniqueFiles.length
  );
  
  const outputFileName = \`output.\${outputFormat}\`;
  
  let args = [
    ...inputFiles.flatMap(f => ['-i', f]),
    '-progress', 'pipe:1',
    '-nostats',
    '-filter_complex', filterComplex.join(';'),
    '-map', \`[\${finalVideoLabel}]\`,
    '-map', \`[\${finalAudioLabel}]\`,
    '-c:v', encodingSettings.videoCodec,
    '-crf', quality,
    '-c:a', outputFormat === 'webm' ? 'libopus' : 'aac',
    '-preset', encodingSettings.preset,
    '-r', String(Math.min(parseInt(settings.fps || '30'), encodingSettings.targetFps)),
    '-pix_fmt', encodingSettings.pixelFormat,
    '-threads', encodingSettings.threads,
    '-shortest',
    outputFileName
  ];
  
  args = buildOptimizedArgs(args, encodingSettings);

  console.log('FFmpeg command:', args.join(' '));
  onProgress?.(10, 'Encodage...');
  await execWithTimeout(ffmpegInstance, args, execTimeoutMs);

  onProgress?.(96, 'Finalisation...');
  const data = await ffmpegInstance.readFile(outputFileName);
  
  onProgress?.(98, 'Nettoyage...');
  for (const fileName of inputFiles) {
    await ffmpegInstance.deleteFile(fileName);
  }
  await ffmpegInstance.deleteFile(outputFileName);
  
  onProgress?.(99, 'Préparation du téléchargement...');

  const actualEncodingTime = (performance.now() - encodingStartTime) / 1000;
  console.log('✅ EXPORT COMPLETE (Multi-Clip)');
  console.log(\`⏱️ Actual encoding time: \${formatEncodingTime(Math.ceil(actualEncodingTime))}\`);
  console.log(\`📈 Speed ratio: \${(currentTotalDuration / actualEncodingTime).toFixed(2)}x realtime\`);
  console.log(\`📊 Clips processed: \${clips.length}\`);

  onProgress?.(100, 'Terminé !');
  return new Blob([data as any], { type: outputFormat === 'webm' ? 'video/webm' : 'video/mp4' });
}

async function _exportProjectInternal(
  clips: ExportClip[],
  settings: ExportSettings,
  onProgress?: (progress: number, message: string) => void,
  textOverlays?: TextOverlay[],
  transitions?: Transition[],
  aspectRatio?: AspectRatio,
  hardwareProfile?: AnyHardwareProfile,
  safeMode: boolean = false,
  audioClips?: ExportAudioClip[]
): Promise<Blob> {
  const hasComplexFeatures = checkComplexFeatures(clips, textOverlays, transitions, audioClips);
  
  if (hasComplexFeatures) {
    console.log('⚠️ Complex features detected (Text/Transitions/Filters/Images/Audio), falling back to FFmpeg for full support.');
  } else {
    try {
        return await exportProjectWithMediaBunny(
            clips,
            settings,
            onProgress,
            textOverlays,
            transitions,
            aspectRatio,
            hardwareProfile,
            safeMode,
            audioClips
        );
    } catch (error) {
        console.error('MediaBunny export failed:', error);
        console.log('Falling back to FFmpeg...');
    }
  }

  if (isOperationInProgress && currentOperationType === 'export') {
    throw new Error('Un export est déjà en cours. Veuillez patienter.');
  }

  if (isOperationInProgress && currentOperationType && currentOperationType !== 'export') {
    console.log('⏳ Waiting for FFmpeg operation to finish:', currentOperationType);
    const start = performance.now();
    const timeoutMs = 4000;
    while (isOperationInProgress && performance.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (isOperationInProgress) {
      console.warn('⚠️ Previous FFmpeg operation did not finish in time, resetting instance...');
      await resetFFmpeg();
    }
  }
  
  isOperationInProgress = true;
  currentOperationType = 'export';
  
  try {
    currentTotalDuration = clips.reduce((acc, clip) => acc + (clip.duration - clip.trimStart - clip.trimEnd), 0);
    
    onProgress?.(1, safeMode ? 'Chargement de FFmpeg (Mode sans échec)...' : 'Chargement de FFmpeg...');
    
    const exportProgressHandler = (percent: number, msg: string) => {
      const scaledPercent = Math.round(percent * 0.95);
      const safePercent = Math.min(95, Math.max(0, scaledPercent));
      onProgress?.(safePercent, \`Traitement en cours...\`);
    };

    const ffmpegInstance = await loadFFmpeg(exportProgressHandler, { safeMode });
    
    if (textOverlays && textOverlays.length > 0 && textOverlays.some(t => t.text.trim())) {
      onProgress?.(2, 'Chargement de la police...');
      await loadDefaultFont(ffmpegInstance);
    }
    
    onProgress?.(3, 'Préparation des paramètres...');
    const effectiveAspectRatio = aspectRatio || settings.aspectRatio || '16:9';
    const resolution = getResolutionForAspectRatio(settings.resolution, effectiveAspectRatio);
    console.log(\`📐 Export resolution: \${resolution.width}x\${resolution.height} (\${effectiveAspectRatio})\`);
    const outputFormat = settings.format;
    
    const effectiveHardwareProfile = hardwareProfile || cachedHardwareProfile;
    const encodingSettings = getOptimalEncodingSettings(
      effectiveHardwareProfile,
      outputFormat as 'mp4' | 'webm',
      settings.quality,
      safeMode
    );
    
    const estimatedTime = estimateEncodingTime(
      effectiveHardwareProfile,
      currentTotalDuration,
      resolution
    );

    const execTimeoutMs = safeMode
      ? Math.max(600_000, estimatedTime * 1000 * 60)
      : Math.max(240_000, estimatedTime * 1000 * 30);
    
    const encodingStartTime = performance.now();
    const quality = encodingSettings.crf;

    if (clips.length === 0) {
      throw new Error('Aucun clip à exporter');
    }

    if (clips.length === 1) {
      return await exportSingleClip(
        ffmpegInstance, clips[0], settings, encodingSettings, resolution, outputFormat, quality,
        execTimeoutMs, encodingStartTime, onProgress, textOverlays, transitions, audioClips, safeMode
      );
    }

    return await exportMultiClip(
      ffmpegInstance, clips, settings, encodingSettings, resolution, outputFormat, quality,
      execTimeoutMs, encodingStartTime, onProgress, textOverlays, transitions, audioClips, safeMode
    );
  } catch (error) {
    console.error('Error in exportProject:', error);
    if (
      error instanceof Error &&
      (
        error.message.includes('Timeout') ||
        error.message.includes('stuck') ||
        error.message.includes('FFmpeg.terminate') ||
        error.message.includes('FS error')
      )
    ) {
      console.warn('FFmpeg error detected, resetting instance...');
      await resetFFmpeg();
    }
    throw error;
  } finally {
    isOperationInProgress = false;
    currentOperationType = null;
  }
}
`;

const newContent = content.substring(0, startIndex) + helpers + '\n' + content.substring(endIndex);

fs.writeFileSync('src/utils/ffmpeg.ts', newContent);
console.log('Refactored ffmpeg.ts successfully');
