import type { FileItem } from '@/service/ssh'
import { File, FileCode, FileText, Folder, Image } from 'lucide-react'

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function getFileKind(file: FileItem): string {
  if (file.is_directory) return 'Folder'
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (
    ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'].includes(ext)
  ) {
    return 'Image'
  }
  if (
    [
      'js',
      'ts',
      'jsx',
      'tsx',
      'py',
      'rs',
      'go',
      'java',
      'c',
      'cpp',
      'h',
      'hpp',
      'css',
      'scss',
      'html',
      'xml',
      'yaml',
      'yml',
      'toml',
      'sh',
      'bash',
      'zsh',
      'php',
      'rb',
      'swift',
      'kt',
    ].includes(ext)
  ) {
    return 'Source Code'
  }
  if (['md', 'txt', 'log', 'conf', 'cfg', 'ini', 'env', 'json'].includes(ext)) {
    return 'Text'
  }
  if (ext === 'pdf') return 'PDF'
  if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].includes(ext)) {
    return 'Archive'
  }
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(ext)) return 'Audio'
  if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'].includes(ext)) {
    return 'Video'
  }
  return 'File'
}

export function getFileIcon(file: FileItem) {
  if (file.is_directory) return <Folder className="size-4 text-yellow-500" />
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(ext)) {
    return <Image className="size-4 text-purple-500" />
  }
  if (
    [
      'js',
      'ts',
      'jsx',
      'tsx',
      'py',
      'rs',
      'go',
      'java',
      'c',
      'cpp',
      'h',
      'css',
      'html',
      'json',
      'xml',
      'yaml',
      'yml',
      'toml',
      'sh',
      'bash',
      'zsh',
    ].includes(ext)
  ) {
    return <FileCode className="size-4 text-blue-400" />
  }
  if (['md', 'txt', 'log', 'conf', 'cfg', 'ini', 'env'].includes(ext)) {
    return <FileText className="size-4 text-gray-400" />
  }
  return <File className="size-4 text-gray-500" />
}
