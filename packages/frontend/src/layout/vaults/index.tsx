import { UploadIcon, UserIcon, VideoIcon } from 'lucide-react'
import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

const VaultsLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="flex h-full">
      <aside
        className={`${collapsed ? 'w-16' : 'w-64'} border-r transition-all`}
      >
        <div className="flex flex-col gap-2 p-4">
          <Button
            variant="ghost"
            className="justify-start gap-2"
            onClick={() => navigate('/')}
          >
            <UserIcon className="h-4 w-4" />
            {!collapsed && 'nav 1'}
          </Button>
          <Button
            variant="ghost"
            className="justify-start gap-2"
            onClick={() => navigate('/demo')}
          >
            <VideoIcon className="h-4 w-4" />
            {!collapsed && 'nav 2'}
          </Button>
          <Button variant="ghost" className="justify-start gap-2">
            <UploadIcon className="h-4 w-4" />
            {!collapsed && 'nav 3'}
          </Button>
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? '>' : '<'}
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  )
}

export default VaultsLayout
