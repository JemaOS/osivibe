const fs = require('fs');

let content = fs.readFileSync('src/utils/ffmpeg.ts', 'utf8');

const helper = `
function buildVideoFilter(
  clip: ExportClip,
  resolution: { width: number; height: number },
  isImage: boolean
): string {
  let filter = '';

  if (clip.crop) {
    const w = \`iw*\${clip.crop.width}/100\`;
    const h = \`ih*\${clip.crop.height}/100\`;
    const x = \`iw*\${clip.crop.x}/100\`;
    const y = \`ih*\${clip.crop.y}/100\`;
    filter += \`crop=\${w}:\${h}:\${x}:\${y}\`;
  }

  if (isImage && clip.transform) {
    const scaleX = clip.transform.scaleX ?? clip.transform.scale;
    const scaleY = clip.transform.scaleY ?? clip.transform.scale;
    
    const actualWidthPct = (80 * scaleX) / 100;
    const actualHeightPct = (80 * scaleY) / 100;
    
    const targetW = Math.max(2, Math.round(resolution.width * actualWidthPct / 100));
    const targetH = Math.max(2, Math.round(resolution.height * actualHeightPct / 100));
    
    if (filter) filter += ',';
    filter += \`scale=\${targetW}:\${targetH}:force_original_aspect_ratio=decrease\`;
    filter += \`,format=rgba,pad=\${targetW}:\${targetH}:(ow-iw)/2:(oh-ih)/2:color=black@0\`;
    
    if (clip.transform.rotation !== 0) {
      const angle = clip.transform.rotation * Math.PI / 180;
      filter += \`,rotate=\${angle}:c=black@0:ow=rotw(\${angle}):oh=roth(\${angle})\`;
    }
    
    const centerX = Math.round(resolution.width * clip.transform.x / 100);
    const centerY = Math.round(resolution.height * clip.transform.y / 100);
    
    const padX = \`\${centerX}-iw/2\`;
    const padY = \`\${centerY}-ih/2\`;
    
    filter += \`,pad=\${resolution.width}:\${resolution.height}:\${padX}:\${padY}:color=black@0\`;
  } else {
    if (filter) filter += ',';
    filter += \`scale=\${resolution.width}:\${resolution.height}:force_original_aspect_ratio=decrease,pad=\${resolution.width}:\${resolution.height}:(ow-iw)/2:(oh-ih)/2\`;
  }

  if (clip.filter) {
    const filterString = getFilterString(clip.filter);
    if (filterString) filter += ',' + filterString;
  }

  return filter;
}
`;

// Insert helper before exportSingleClipFastPath
content = content.replace(
  'async function exportSingleClipFastPath(',
  helper + '\nasync function exportSingleClipFastPath('
);

// Update exportSingleClipFastPath
content = content.replace(
  /let videoFilterChain = `scale=\$\{resolution\.width\}:\$\{resolution\.height\}:force_original_aspect_ratio=decrease,pad=\$\{resolution\.width\}:\$\{resolution\.height\}:\(ow-iw\)\/2:\(oh-ih\)\/2`;\s*if \(clip\.filter\) \{\s*const filterString = getFilterString\(clip\.filter\);\s*if \(filterString\) \{\s*videoFilterChain \+= ',' \+ filterString;\s*\}\s*\}/,
  'const isImage = clip.file.type.startsWith("image/");\n  let videoFilterChain = buildVideoFilter(clip, resolution, isImage);'
);

// Update exportSingleClipComplexPath
content = content.replace(
  /let vBase = `\[0:v\]trim=start=\$\{clip\.trimStart\}:duration=\$\{clipDuration\},setpts=PTS-STARTPTS,scale=\$\{resolution\.width\}:\$\{resolution\.height\}:force_original_aspect_ratio=decrease,pad=\$\{resolution\.width\}:\$\{resolution\.height\}:\(ow-iw\)\/2:\(oh-ih\)\/2,fps=\$\{effectiveFps\}`;\s*if \(clip\.filter\) \{\s*const filterString = getFilterString\(clip\.filter\);\s*if \(filterString\) vBase \+= `,\$\{filterString\}`;\s*\}/,
  'const isImage = clip.file.type.startsWith("image/");\n  const baseFilter = buildVideoFilter(clip, resolution, isImage);\n  let vBase = `[0:v]trim=start=${clip.trimStart}:duration=${clipDuration},setpts=PTS-STARTPTS,${baseFilter},fps=${effectiveFps}`;'
);

// Update buildMultiClipFilterChain
content = content.replace(
  /let videoFilter = '';\s*if \(isImage\) \{\s*videoFilter = `\[\$\{inputIndex\}:v\]loop=loop=-1:size=1:start=0,trim=duration=\$\{duration\},setpts=PTS-STARTPTS,scale=\$\{resolution\.width\}:\$\{resolution\.height\}:force_original_aspect_ratio=decrease,pad=\$\{resolution\.width\}:\$\{resolution\.height\}:\(ow-iw\)\/2:\(oh-ih\)\/2`;\s*if \(needsFpsNormalization\) videoFilter \+= `,fps=\$\{targetFps\}`;\s*if \(needsPerClipTimebaseNormalization\) videoFilter \+= `,settb=1\/\$\{targetFps\}`;\s*\} else \{\s*videoFilter = `\[\$\{inputIndex\}:v\]trim=start=\$\{clip\.trimStart\}:duration=\$\{duration\},setpts=PTS-STARTPTS`;\s*if \(needsScalePad\) \{\s*videoFilter \+= `,scale=\$\{resolution\.width\}:\$\{resolution\.height\}:force_original_aspect_ratio=decrease,pad=\$\{resolution\.width\}:\$\{resolution\.height\}:\(ow-iw\)\/2:\(oh-ih\)\/2`;\s*\}\s*if \(needsFpsNormalization\) videoFilter \+= `,fps=\$\{targetFps\}`;\s*if \(needsPerClipTimebaseNormalization\) videoFilter \+= `,settb=1\/\$\{targetFps\}`;\s*\}\s*if \(clip\.filter\) \{\s*const filterString = getFilterString\(clip\.filter\);\s*if \(filterString\) videoFilter \+= ',' \+ filterString;\s*\}/,
  `const baseFilter = buildVideoFilter(clip, resolution, isImage);
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
    if (needsPerClipTimebaseNormalization) videoFilter += \`,settb=1/\${targetFps}\`;`
);

fs.writeFileSync('src/utils/ffmpeg.ts', content);
