import { observer } from "mobx-react-lite";
import { useState, useEffect, useCallback } from "react";
import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import { HostStore } from "@/store/host";
import { Terminal, Folder, File, Upload, Download, RefreshCw, ChevronRight, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sshService } from "@/service/ssh";

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedTime: number;
  permissions: string;
}

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedTime: number;
  permissions: string;
}

interface SFTPContainerProps {
  sessionId?: string;
}

const SFTPContainer: React.FC<SFTPContainerProps> = observer(({ sessionId }) => {
  const app = useInjectable(AppStore);
  const hostStore = useInjectable(HostStore);

  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const activeTab = app.activeTab;
  const host = activeTab?.hostId
    ? hostStore.hosts.find(h => h.id === activeTab.hostId)
    : null;

  // Get current path parts for breadcrumbs
  const pathParts = currentPath.split('/').filter(Boolean);

  // Load file list from backend
  const loadFiles = useCallback(async () => {
    if (!sessionId) {
      // Use demo data when no session
      setLoading(true);
      setTimeout(() => {
        const demoFiles: FileItem[] = [
          { name: '..', path: currentPath, isDirectory: true, size: 0, modifiedTime: Date.now(), permissions: 'drwxr-xr-x' },
          { name: '.', path: currentPath, isDirectory: true, size: 0, modifiedTime: Date.now(), permissions: 'drwxr-xr-x' },
          { name: 'home', path: currentPath + '/home', isDirectory: true, size: 4096, modifiedTime: Date.now() - 86400000, permissions: 'drwxr-xr-x' },
          { name: 'etc', path: currentPath + '/etc', isDirectory: true, size: 4096, modifiedTime: Date.now() - 172800000, permissions: 'drwxr-xr-x' },
          { name: 'var', path: currentPath + '/var', isDirectory: true, size: 4096, modifiedTime: Date.now() - 259200000, permissions: 'drwxr-xr-x' },
          { name: 'usr', path: currentPath + '/usr', isDirectory: true, size: 4096, modifiedTime: Date.now() - 345600000, permissions: 'drwxr-xr-x' },
          { name: 'bin', path: currentPath + '/bin', isDirectory: true, size: 4096, modifiedTime: Date.now() - 432000000, permissions: 'drwxr-xr-x' },
          { name: 'README.md', path: currentPath + '/README.md', isDirectory: false, size: 1024, modifiedTime: Date.now() - 518400000, permissions: '-rw-r--r--' },
          { name: 'package.json', path: currentPath + '/package.json', isDirectory: false, size: 2048, modifiedTime: Date.now() - 604800000, permissions: '-rw-r--r--' },
        ];
        setFiles(demoFiles);
        setLoading(false);
      }, 500);
      return;
    }

    setLoading(true);
    try {
      const result = await sshService.sftpList(sessionId, currentPath);
      if (result.success && result.files) {
        const mappedFiles: FileItem[] = result.files.map(f => ({
          name: f.name,
          path: f.path,
          isDirectory: f.is_directory,
          size: f.size,
          modifiedTime: f.modified_time,
          permissions: f.permissions,
        }));
        setFiles(mappedFiles);
      } else {
        console.error("Failed to load files:", result.message);
        // Fall back to demo data
        setFiles([
          { name: '..', path: currentPath, isDirectory: true, size: 0, modifiedTime: Date.now(), permissions: 'drwxr-xr-x' },
          { name: '.', path: currentPath, isDirectory: true, size: 0, modifiedTime: Date.now(), permissions: 'drwxr-xr-x' },
        ]);
      }
    } catch (error) {
      console.error("Error loading files:", error);
    } finally {
      setLoading(false);
    }
  }, [sessionId, currentPath]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleFileClick = (file: FileItem) => {
    if (file.isDirectory && file.name !== '..' && file.name !== '.') {
      navigateTo(file.path);
    } else if (file.name === '..') {
      navigateUp();
    } else {
      setSelectedFile(file.path);
    }
  };

  const navigateTo = (path: string) => {
    setCurrentPath(path || '/');
    setSelectedFile(null);
  };

  const navigateUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath('/' + parts.join('/'));
  };

  const navigateToHome = () => {
    setCurrentPath('/home');
  };

  const handleRefresh = () => {
    loadFiles();
  };

  const handleUpload = async () => {
    // In a real implementation, this would open a file picker
    // For now, we'll use a simple prompt
    const localPath = prompt("Enter local file path:");
    if (!localPath) return;
    
    const fileName = localPath.split(/[\\/]/).pop() || "file";
    const remotePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
    
    try {
      const result = await sshService.sftpUpload(sessionId!, localPath, remotePath);
      if (result.success) {
        loadFiles();
      } else {
        alert(`Failed to upload: ${result.message}`);
      }
    } catch (error) {
      console.error("Error uploading file:", error);
    }
  };

  const handleDownload = async () => {
    if (!selectedFile || !sessionId) return;
    
    const localPath = prompt("Enter local save path:");
    if (!localPath) return;
    
    try {
      const result = await sshService.sftpDownload(sessionId, selectedFile, localPath);
      if (result.success) {
        alert("File downloaded successfully!");
      } else {
        alert(`Failed to download: ${result.message}`);
      }
    } catch (error) {
      console.error("Error downloading file:", error);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString();
  };

  if (!host) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center">
          <Terminal className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">No Host Connected</h2>
          <p className="text-muted-foreground">
            Select a host from the sidebar to start SFTP transfer
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b">
        <Button variant="ghost" size="icon" onClick={navigateUp} title="Go up">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={navigateToHome} title="Go home">
          <Home className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>

        <div className="flex-1 mx-2 px-3 py-1 bg-muted rounded text-sm font-mono">
          {host?.name || 'Local'}:{currentPath}
        </div>

        <div className="flex items-center gap-1">
          <Button 
            variant="ghost" 
            size="sm"
            disabled
            title="New folder (coming soon)"
          >
            <Folder className="h-4 w-4 mr-1" />
            New Folder
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={handleUpload}
            disabled={!sessionId}
            title="Upload file"
          >
            <Upload className="h-4 w-4 mr-1" />
            Upload
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            disabled={!selectedFile || !sessionId}
            onClick={handleDownload}
            title="Download file"
          >
            <Download className="h-4 w-4 mr-1" />
            Download
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-4 py-2 text-sm border-b bg-muted/30">
        <span className="font-medium">{host.name}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <span
          className="cursor-pointer hover:underline"
          onClick={() => navigateTo('/')}
        >
          /
        </span>
        {pathParts.map((part, index) => (
          <span key={index} className="flex items-center">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span
              className="cursor-pointer hover:underline"
              onClick={() => navigateTo('/' + pathParts.slice(0, index + 1).join('/'))}
            >
              {part}
            </span>
          </span>
        ))}
      </div>

      {/* File List */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium w-24">Size</th>
              <th className="px-4 py-2 font-medium w-32">Modified</th>
              <th className="px-4 py-2 font-medium w-32">Permissions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : (
              files.map((file, index) => (
                <tr
                  key={index}
                  className={`cursor-pointer hover:bg-muted/50 ${
                    selectedFile === file.path ? 'bg-accent' : ''
                  }`}
                  onClick={() => handleFileClick(file)}
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      {file.isDirectory ? (
                        <Folder className="h-4 w-4 text-yellow-500" />
                      ) : (
                        <File className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={file.name === '..' ? 'text-muted-foreground' : ''}>
                        {file.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {file.isDirectory ? '-' : formatSize(file.size)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {formatDate(file.modifiedTime)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground font-mono text-xs">
                    {file.permissions}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-1 text-xs text-muted-foreground border-t bg-muted/30">
        <span>{files.length} items</span>
        <span>Connected to {host.name} ({host.hostname})</span>
      </div>
    </div>
  );
});

export default SFTPContainer;
