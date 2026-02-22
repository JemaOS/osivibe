// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

export function formatTime(seconds: number): string {
  if (Number.isNaN(seconds) || seconds < 0) return '00:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatTimeWithMs(seconds: number): string {
  if (Number.isNaN(seconds) || seconds < 0) return '00:00:00';
  
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
}

export function parseTime(timeString: string): number {
  const parts = timeString.split(':').map(Number);
  
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  
  return parts[0] || 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'Ko', 'Mo', 'Go'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getFileType(file: File): 'video' | 'audio' | 'image' | 'unknown' {
  const mimeType = file.type.toLowerCase();
  
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('image/')) return 'image';
  
  // Check by extension
  const ext = file.name.split('.').pop()?.toLowerCase();
  
  const videoExtensions = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'];
  const audioExtensions = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'];
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
  
  if (ext && videoExtensions.includes(ext)) return 'video';
  if (ext && audioExtensions.includes(ext)) return 'audio';
  if (ext && imageExtensions.includes(ext)) return 'image';
  
  return 'unknown';
}

export function isValidMediaFile(file: File): boolean {
  const type = getFileType(file);
  return type !== 'unknown';
}

export function generateId(): string {
  const array = new Uint32Array(2);
  crypto.getRandomValues(array);
  return array[0].toString(36) + array[1].toString(36);
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function getCSSFilter(filter: { brightness: number; contrast: number; saturation: number; grayscale: boolean; sepia: boolean; blur: number }): string {
  const filters: string[] = [];
  
  if (filter.brightness !== 0) {
    filters.push(`brightness(${1 + filter.brightness / 100})`);
  }
  
  if (filter.contrast !== 0) {
    filters.push(`contrast(${1 + filter.contrast / 100})`);
  }
  
  if (filter.saturation !== 0) {
    filters.push(`saturate(${1 + filter.saturation / 100})`);
  }
  
  if (filter.grayscale) {
    filters.push('grayscale(1)');
  }
  
  if (filter.sepia) {
    filters.push('sepia(1)');
  }
  
  if (filter.blur > 0) {
    filters.push(`blur(${filter.blur}px)`);
  }
  
  return filters.length > 0 ? filters.join(' ') : 'none';
}
