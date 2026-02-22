const fs = require('fs');

let content = fs.readFileSync('src/utils/ffmpeg.ts', 'utf8');

const newBuildMultiClipFilterChain = `
function buildMultiClipFilterChain(
  clips: ExportClip[],
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
  
  // Group clips by trackIndex
  const tracksMap = new Map<number, ExportClip[]>();
  clips.forEach(clip => {
    const trackIndex = clip.trackIndex ?? 0;
    if (!tracksMap.has(trackIndex)) {
      tracksMap.set(trackIndex, []);
    }
    tracksMap.get(trackIndex)!.push(clip);
  });

  // Sort tracks by index
  const trackIndices = Array.from(tracksMap.keys()).sort((a, b) => a - b);
  
  // Calculate total duration
  const totalDuration = Math.max(
    0,
    ...clips.map((c) => {
      const d = c.duration - c.trimStart - c.trimEnd;
      return Math.max(0, c.startTime - timeOrigin) + Math.max(0, d);
    })
  );

  const trackVideoLabels: string[] = [];
  const trackAudioLabels: string[] = [];
  let gapCounter = 0;

  for (const trackIndex of trackIndices) {
    const trackClips = tracksMap.get(trackIndex)!.sort((a, b) => a.startTime - b.startTime);
    const isBaseTrack = trackIndex === trackIndices[0];
    
    const trackVideoSegments: string[] = [];
    const trackAudioSegments: string[] = [];
    
    let currentTime = timeOrigin;
    
    for (let i = 0; i < trackClips.length; i++) {
      const clip = trackClips[i];
      const originalIndex = clips.indexOf(clip);
      const inputIndex = clipToInputIndex.get(originalIndex) ?? originalIndex;
      const isImage = clip.file.type.startsWith('image/');
      const duration = clip.duration - clip.trimStart - clip.trimEnd;
      
      // Add gap if needed
      if (clip.startTime > currentTime + 0.01) {
        const gapDuration = clip.startTime - currentTime;
        const gapVideoLabel = \`vgap\${gapCounter}\`;
        const gapAudioLabel = \`agap\${gapCounter}\`;
        
        // Base track gap is black, overlay track gap is transparent
        const gapColor = isBaseTrack ? 'black' : 'black@0';
        const gapFormat = isBaseTrack ? 'yuv420p' : 'rgba';
        
        filterComplex.push(\`color=c=\${gapColor}:s=\${resolution.width}x\${resolution.height}:d=\${gapDuration}:r=\${targetFps},format=\${gapFormat}[\${gapVideoLabel}]\`);
        filterComplex.push(\`aevalsrc=0:d=\${gapDuration}:s=48000:c=stereo[\${gapAudioLabel}]\`);
        
        trackVideoSegments.push(\`[\${gapVideoLabel}]\`);
        trackAudioSegments.push(\`[\${gapAudioLabel}]\`);
        gapCounter++;
      }
      
      // Process clip
      const meta = inputVideoMeta.get(inputIndex);
      const needsScalePad = !isImage && meta ? (meta.width !== resolution.width || meta.height !== resolution.height) : true;
      
      const baseFilter = buildVideoFilter(clip, resolution, isImage);
      let videoFilter = '';
      if (isImage) {
        videoFilter = \`[\${inputIndex}:v]loop=loop=-1:size=1:start=0,trim=duration=\${duration},setpts=PTS-STARTPTS,\${baseFilter}\`;
      } else {
        videoFilter = \`[\${inputIndex}:v]trim=start=\${clip.trimStart}:duration=\${duration},setpts=PTS-STARTPTS\`;
        if (needsScalePad || clip.crop) {
          videoFilter += \`,\${baseFilter}\`;
        } else if (clip.filter) {
          const filterString = getFilterString(clip.filter);
          if (filterString) videoFilter += ',' + filterString;
        }
      }
      if (needsFpsNormalization) videoFilter += \`,fps=\${targetFps}\`;
      if (needsPerClipTimebaseNormalization) videoFilter += \`,settb=1/\${targetFps}\`;
      
      // If it's an overlay track, ensure it has an alpha channel
      if (!isBaseTrack && !videoFilter.includes('format=rgba')) {
        videoFilter += ',format=rgba';
      }
      
      const clipVideoLabel = \`v\${originalIndex}\`;
      const clipAudioLabel = \`a\${originalIndex}\`;
      
      filterComplex.push(\`\${videoFilter}[\${clipVideoLabel}]\`);
      
      if (isImage || clip.audioMuted) {
        filterComplex.push(\`aevalsrc=0:d=\${duration}:s=48000:c=stereo[\${clipAudioLabel}]\`);
      } else {
        filterComplex.push(\`[\${inputIndex}:a]atrim=start=\${clip.trimStart}:duration=\${duration},asetpts=PTS-STARTPTS[\${clipAudioLabel}]\`);
      }
      
      trackVideoSegments.push(\`[\${clipVideoLabel}]\`);
      trackAudioSegments.push(\`[\${clipAudioLabel}]\`);
      
      currentTime = clip.startTime + duration;
    }
    
    // Add trailing gap if needed
    if (currentTime < timeOrigin + totalDuration - 0.01) {
      const gapDuration = timeOrigin + totalDuration - currentTime;
      const gapVideoLabel = \`vgap\${gapCounter}\`;
      const gapAudioLabel = \`agap\${gapCounter}\`;
      
      const gapColor = isBaseTrack ? 'black' : 'black@0';
      const gapFormat = isBaseTrack ? 'yuv420p' : 'rgba';
      
      filterComplex.push(\`color=c=\${gapColor}:s=\${resolution.width}x\${resolution.height}:d=\${gapDuration}:r=\${targetFps},format=\${gapFormat}[\${gapVideoLabel}]\`);
      filterComplex.push(\`aevalsrc=0:d=\${gapDuration}:s=48000:c=stereo[\${gapAudioLabel}]\`);
      
      trackVideoSegments.push(\`[\${gapVideoLabel}]\`);
      trackAudioSegments.push(\`[\${gapAudioLabel}]\`);
      gapCounter++;
    }
    
    // Concat track segments
    const trackVideoOut = \`trackv\${trackIndex}\`;
    const trackAudioOut = \`tracka\${trackIndex}\`;
    
    if (trackVideoSegments.length === 1) {
      filterComplex.push(\`\${trackVideoSegments[0]}null[\${trackVideoOut}]\`);
      filterComplex.push(\`\${trackAudioSegments[0]}anull[\${trackAudioOut}]\`);
    } else {
      filterComplex.push(\`\${trackVideoSegments.join('')}concat=n=\${trackVideoSegments.length}:v=1:a=0,settb=1/\${targetFps}[\${trackVideoOut}]\`);
      filterComplex.push(\`\${trackAudioSegments.join('')}concat=n=\${trackAudioSegments.length}:v=0:a=1[\${trackAudioOut}]\`);
    }
    
    trackVideoLabels.push(\`[\${trackVideoOut}]\`);
    trackAudioLabels.push(\`[\${trackAudioOut}]\`);
  }
  
  // Overlay tracks
  let currentVideoLabel = trackVideoLabels[0].replace(/[\\[\\]]/g, '');
  for (let i = 1; i < trackVideoLabels.length; i++) {
    const overlayLabel = trackVideoLabels[i].replace(/[\\[\\]]/g, '');
    const outLabel = \`mergedv\${i}\`;
    filterComplex.push(\`[\${currentVideoLabel}][\${overlayLabel}]overlay=0:0:shortest=1[\${outLabel}]\`);
    currentVideoLabel = outLabel;
  }
  
  // Mix audio tracks
  let currentAudioLabel = 'outa';
  if (trackAudioLabels.length === 1) {
    filterComplex.push(\`\${trackAudioLabels[0]}anull[\${currentAudioLabel}]\`);
  } else {
    filterComplex.push(\`\${trackAudioLabels.join('')}amix=inputs=\${trackAudioLabels.length}:duration=longest[\${currentAudioLabel}]\`);
  }
  
  // Add text overlays
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
  const finalAudioLabel = externalAudioClips.length > 0 ? 'outa_ext' : currentAudioLabel;

  if (externalAudioClips.length > 0) {
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

    const tail = totalDuration - cursor;
    if (tail > 0.01) {
      const tl = \`atail\${seg++}\`;
      filterComplex.push(\`aevalsrc=0:d=\${tail}:s=48000:c=stereo[\${tl}]\`);
      parts.push(\`[\${tl}]\`);
    }

    if (parts.length === 0) {
      filterComplex.push(\`aevalsrc=0:d=\${totalDuration}:s=48000:c=stereo[\${finalAudioLabel}]\`);
    } else {
      filterComplex.push(\`\${parts.join('')}concat=n=\${parts.length}:v=0:a=1[\${finalAudioLabel}]\`);
    }
  }

  return { filterComplex, finalVideoLabel, finalAudioLabel };
}
`;

const startIndex = content.indexOf('function buildMultiClipFilterChain(');
const endIndex = content.indexOf('async function exportMultiClip(');

if (startIndex === -1 || endIndex === -1) {
  console.error('Could not find start or end index');
  process.exit(1);
}

content = content.substring(0, startIndex) + newBuildMultiClipFilterChain + '\n' + content.substring(endIndex);

// Also update exportMultiClip to not use detectGaps
content = content.replace(
  'const { gaps, gapMap } = detectGaps(clips);',
  ''
);
content = content.replace(
  'clips, gaps, gapMap, clipToInputIndex, inputVideoMeta, transitions, textOverlays,',
  'clips, clipToInputIndex, inputVideoMeta, transitions, textOverlays,'
);

fs.writeFileSync('src/utils/ffmpeg.ts', content);
