import { ViewContainer, ViewToolbar, ViewContent, ViewHeader } from '@/components/view-container'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowRight, Bug, Terminal } from 'lucide-react'
import { Link } from 'react-router-dom'

const experiments = [
  {
    path: '/experiments/textarea-test',
    title: 'Textarea Input Test',
    description: '测试 textarea 元素的字符输入事件监听',
    icon: <Bug className="size-6" />,
  },
  {
    path: '/experiments/xterm-test',
    title: 'Xterm.js Input Test',
    description: '测试 xterm.js Terminal 实例的字符输入事件',
    icon: <Terminal className="size-6" />,
  },
]

const ExperimentsIndex: React.FC = () => {
  return (
    <ViewContainer>
      <ViewToolbar />
      <ViewContent className="p-6">
        <ViewHeader
          title="开发测试"
          description="Experiments — 实验性功能测试页面，仅开发模式可用"
        />
        <div className="mt-6 grid gap-4 grid-cols-1 md:grid-cols-2">
          {experiments.map(exp => (
            <Link key={exp.path} to={exp.path}>
              <Card className="hover:bg-secondary/50 transition-colors cursor-pointer">
                <CardHeader className="flex flex-row items-center gap-4">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    {exp.icon}
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-base">{exp.title}</CardTitle>
                    <CardDescription>{exp.description}</CardDescription>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </ViewContent>
    </ViewContainer>
  )
}

export default ExperimentsIndex
