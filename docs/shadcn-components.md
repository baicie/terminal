# shadcn/ui 组件文档

> shadcn/ui 官方组件库，基于 Radix UI 原语构建，使用 Tailwind CSS 样式，具备完整 WAI-ARIA 无障碍支持。
>
> **官方文档**: https://ui.shadcn.com/docs/components
>
> **组件来源**: 通过 CLI 复制源代码到项目中（非 npm 包），代码完全可控可修改。
>
> **安装命令**: `pnpm dlx shadcn@latest add <component-name>`
>
> **搜索组件**: `pnpm dlx shadcn@latest search @shadcn -q "keyword"`

---

## 按分类索引

| 分类                         | 组件                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [交互](#1-交互)              | Accordion、Alert、Alert Dialog、Collapsible、Dialog、Hover Card、Popover、Progress、Scroll Area、Separator、Sheet、Slider、Switch、Toggle、Tooltip |
| [按钮](#2-按钮)              | Button、Button Group                                                                                                                               |
| [表单](#3-表单)              | Checkbox、Combobox、Date Picker、Input、Input Group、Input OTP、Label、Native Select、Radio Group、Select、Textarea                                |
| [导航](#4-导航)              | Breadcrumb、Menubar、Navigation Menu、Pagination、Tabs                                                                                             |
| [数据展示](#5-数据展示)      | Aspect Ratio、Avatar、Badge、Card、Data Table、Empty、Kbd、Skeleton、Table、Typography                                                             |
| [代码](#6-代码)              | Command                                                                                                                                            |
| [时间/日历](#7-时间日历)     | Calendar                                                                                                                                           |
| [设备框架](#8-设备框架)      | Resizable                                                                                                                                          |
| [可视化](#9-可视化)          | Chart、Progress                                                                                                                                    |
| [布局](#10-布局)             | Resizable、Separator                                                                                                                               |
| [媒体](#11-媒体)             | Avatar                                                                                                                                             |
| [特殊效果](#12-特殊效果)     | Toggle                                                                                                                                             |
| [金融](#13-金融)             | (暂无)                                                                                                                                             |
| [文本与反馈](#14-文本与反馈) | Alert、Badge、Empty、Progress、Skeleton、Sonner、Spinner、Toast                                                                                    |

---

## 1. 交互（Interactive）

### Accordion

手风琴折叠面板，支持单项或多项展开。

```
安装: pnpm dlx shadcn@latest add accordion
```

**何时使用**: FAQ、设置分组、需要分层展示的内容。

**示例**:

```tsx
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
;<Accordion type="single" collapsible>
  <AccordionItem value="item-1">
    <AccordionTrigger>What is shadcn/ui?</AccordionTrigger>
    <AccordionContent>
      It is a collection of re-usable components.
    </AccordionContent>
  </AccordionItem>
</Accordion>
```

---

### Alert

提示信息框，支持不同级别（info、success、warning、error）。

```
安装: pnpm dlx shadcn@latest add alert
```

**何时使用**: 表单验证提示、操作反馈、系统通知。

**示例**:

```tsx
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
;<Alert>
  <AlertCircle className="size-4" />
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Your session has expired.</AlertDescription>
</Alert>
```

---

### Alert Dialog

带有确认/取消操作的提示对话框，用于不可逆操作前的二次确认。

```
安装: pnpm dlx shadcn@latest add alert-dialog
```

**何时使用**: 删除主机、退出确认、危险操作前确认。

**示例**:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
;<AlertDialog>
  <AlertDialogTrigger>Delete</AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction>Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

---

### Collapsible

可折叠内容区，与 Accordion 类似但更轻量。

```
安装: pnpm dlx shadcn@latest add collapsible
```

**何时使用**: 可展开的高级设置、详情展示。

---

### Dialog

模态对话框。

```
安装: pnpm dlx shadcn@latest add dialog
```

**何时使用**: 主机编辑、设置弹窗、命令面板。**本项目已在 `components/ui/dialog.tsx`**。

**示例**:

```tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
;<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Edit Host</DialogTitle>
      <DialogDescription>Update the host configuration.</DialogDescription>
    </DialogHeader>
    {/* 表单内容 */}
    <DialogFooter>
      <Button variant="outline">Cancel</Button>
      <Button>Save</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

### Hover Card

鼠标悬停时显示的浮层卡片，无需点击即可展示预览信息。

```
安装: pnpm dlx shadcn@latest add hover-card
```

**何时使用**: 主机详情预览、快捷操作面板。

---

### Popover

弹出浮层，支持任意内容。

```
安装: pnpm dlx shadcn@latest add popover
```

**何时使用**: 下拉菜单、工具提示、快捷操作。

---

### Progress

进度条。

```
安装: pnpm dlx shadcn@latest add progress
```

**何时使用**: 文件传输进度、连接进度指示。

**示例**:

```tsx
import { Progress } from '@/components/ui/progress'
;<Progress value={66} />
```

---

### Scroll Area

带样式的滚动区域，支持自定义滚动条样式。

```
安装: pnpm dlx shadcn@latest add scroll-area
```

**何时使用**: 日志列表、命令输出区、自定义列表滚动。

---

### Separator

分隔线。

```
安装: pnpm dlx shadcn@latest add separator
```

**何时使用**: 表单分组、标题与内容分隔、设置项分组。**替代原生 `<hr>` 或 `border-t` div**。

**示例**:

```tsx
import { Separator } from "@/components/ui/separator";

<Separator />
<Separator orientation="vertical" className="h-4" />
```

---

### Sheet

侧边抽屉面板，类似于 Dialog 但从屏幕边缘滑入。

```
安装: pnpm dlx shadcn@latest add sheet
```

**何时使用**: 主机详情面板、设置侧边栏、筛选面板。

---

### Slider

滑块输入。

```
安装: pnpm dlx shadcn@latest add slider
```

**何时使用**: 字体大小调节、终端透明度、速度控制。

---

### Switch

开关切换。

```
安装: pnpm dlx shadcn@latest add switch
```

**何时使用**: 设置页布尔选项、启用/禁用功能。**表单中优先使用 Switch，Checkbox 用于多选列表**。

**示例**:

```tsx
import { Switch } from '@/components/ui/switch'
;<Switch checked={enabled} onCheckedChange={setEnabled} />
```

---

### Toggle

可切换的按钮状态。

```
安装: pnpm dlx shadcn@latest add toggle
```

**何时使用**: 工具栏按钮切换、格式切换（粗体/斜体）。

---

### Tooltip

鼠标悬停提示。

```
安装: pnpm dlx shadcn@latest add tooltip
```

**何时使用**: 图标按钮说明、缩写解释、快捷键提示。

**示例**:

```tsx
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
;<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button size="icon">
        <Settings />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Settings</TooltipContent>
  </Tooltip>
</TooltipProvider>
```

---

## 2. 按钮（Buttons）

### Button

按钮组件，支持多种变体和尺寸。**本项目已在 `components/ui/button.tsx`**。

```
安装: pnpm dlx shadcn@latest add button
```

**变体（variant）**:

| 值            | 用途                   |
| ------------- | ---------------------- |
| `default`     | 主操作按钮（蓝色填充） |
| `destructive` | 危险操作（红色）       |
| `outline`     | 次要操作（描边）       |
| `secondary`   | 次要操作（灰色填充）   |
| `ghost`       | 弱化操作（透明背景）   |
| `link`        | 链接样式               |

**尺寸（size）**:

| 值        | 尺寸                     |
| --------- | ------------------------ |
| `default` | h-9 px-4                 |
| `sm`      | h-8 px-3                 |
| `lg`      | h-10 px-6                |
| `icon`    | size-9（正方形图标按钮） |
| `icon-xs` | size-6                   |
| `icon-sm` | size-8                   |

**示例**:

```tsx
import { Button } from "@/components/ui/button";

<Button variant="default">Save</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Cancel</Button>
<Button variant="ghost">Close</Button>
<Button size="icon"><Settings className="size-4" /></Button>
```

> **图标规范**: Button 内的图标使用 `data-icon="inline-start"` 或 `data-icon="inline-end"`，不需要手动设置图标尺寸类。

---

### Button Group

按钮组，将多个按钮组合在一起。

```
安装: pnpm dlx shadcn@latest add button-group
```

---

## 3. 表单（Forms）

### Checkbox

复选框。

```
安装: pnpm dlx shadcn@latest add checkbox
```

**何时使用**: 表单多选、日志筛选标签。**布尔开关优先用 Switch**。

**示例**:

```tsx
import { Checkbox } from '@/components/ui/checkbox'
;<Checkbox id="terms" checked={checked} onCheckedChange={setChecked} />
```

---

### Combobox

可搜索的下拉选择器，基于 Command 组件。

```
安装: pnpm dlx shadcn@latest add combobox
```

**何时使用**: 主机搜索选择、SSH 用户名选择、命令搜索。

---

### Date Picker

日期选择器。

```
安装: pnpm dlx shadcn@latest add date-picker
```

**何时使用**: 日志按日期筛选、计划任务设置。

---

### Input

单行文本输入框。**本项目已在 `components/ui/input.tsx`**。

```
安装: pnpm dlx shadcn@latest add input
```

**示例**:

```tsx
import { Input } from '@/components/ui/input'
;<Input
  placeholder="user@hostname"
  value={value}
  onChange={e => setValue(e.target.value)}
/>
```

> **禁止**: 不要直接使用 `<input>` 原生元素，统一使用 `Input` 组件。

---

### Input Group

带前缀/后缀/按钮的输入框组合。

```
安装: pnpm dlx shadcn@latest add input-group
```

**何时使用**: 搜索框 + 搜索按钮、URL 输入框 + 前缀下拉。**禁止使用原生 div + absolute 定位按钮**。

**示例**:

```tsx
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
;<InputGroup>
  <InputGroupInput placeholder="Search..." />
  <InputGroupAddon>
    <Button size="icon">
      <Search className="size-4" />
    </Button>
  </InputGroupAddon>
</InputGroup>
```

---

### Input OTP

一次性密码/验证码输入框。

```
安装: pnpm dlx shadcn@latest add input-otp
```

**何时使用**: SSH 验证码输入、TOTP 两步验证。

---

### Label

表单标签。**本项目已在 `components/ui/label.tsx`**。

```
安装: pnpm dlx shadcn@latest add label
```

**何时使用**: 所有表单项都需要 Label。**禁止使用原生 `<label>`**。

**示例**:

```tsx
import { Label } from "@/components/ui/label";

<Label htmlFor="hostname">Hostname</Label>
<Input id="hostname" placeholder="192.168.1.1" />
```

---

### Native Select

原生下拉选择器（无 JS 依赖）。

```
安装: pnpm dlx shadcn@latest add native-select
```

> **注意**: 仅在无障碍要求极低、不需要样式定制的简单场景使用。**一般情况下优先使用 `Select`**。

---

### Radio Group

单选按钮组。

```
安装: pnpm dlx shadcn@latest add radio-group
```

**何时使用**: 认证类型选择（Password / Key / Agent）、端口转发类型选择。

**示例**:

```tsx
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
;<RadioGroup value={value} onValueChange={setValue}>
  <div className="flex items-center gap-2">
    <RadioGroupItem value="password" />
    <Label htmlFor="r1">Password</Label>
  </div>
  <div className="flex items-center gap-2">
    <RadioGroupItem value="key" />
    <Label htmlFor="r2">SSH Key</Label>
  </div>
</RadioGroup>
```

---

### Select

下拉选择框。**本项目已在 `components/ui/select.tsx`**。

```
安装: pnpm dlx shadcn@latest add select
```

**何时使用**: 主机分组选择、认证方式选择、视图切换。**禁止使用原生 `<select>`**。

**子组件**:

| 组件              | 用途                   |
| ----------------- | ---------------------- |
| `SelectTrigger`   | 下拉触发器（显示区域） |
| `SelectContent`   | 下拉选项列表           |
| `SelectItem`      | 单个选项               |
| `SelectValue`     | 显示选中值             |
| `SelectLabel`     | 分组标签               |
| `SelectGroup`     | 选项分组               |
| `SelectSeparator` | 分隔线                 |

**示例**:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
;<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="Select option" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="opt1">Option 1</SelectItem>
    <SelectItem value="opt2">Option 2</SelectItem>
  </SelectContent>
</Select>
```

---

### Textarea

多行文本输入。**本项目已在 `components/ui/textarea.tsx`**。

```
安装: pnpm dlx shadcn@latest add textarea
```

**何时使用**: SSH 私钥输入、启动命令、多行配置。**禁止使用原生 `<textarea>`**。

**示例**:

```tsx
import { Textarea } from '@/components/ui/textarea'
;<Textarea
  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
  value={key}
  onChange={e => setKey(e.target.value)}
/>
```

---

## 4. 导航（Navigation）

### Breadcrumb

面包屑导航。

```
安装: pnpm dlx shadcn@latest add breadcrumb
```

**何时使用**: SFTP 文件路径导航（`/home > ubuntu > project`）。

**示例**:

```tsx
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
;<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbLink>home</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator>/</BreadcrumbSeparator>
    <BreadcrumbItem>
      <BreadcrumbLink>ubuntu</BreadcrumbLink>
    </BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

---

### Menubar

顶部菜单栏。

```
安装: pnpm dlx shadcn@latest add menubar
```

**何时使用**: 应用顶部全局菜单（File、Edit、View...）。

---

### Navigation Menu

导航菜单，支持多级下拉。

```
安装: pnpm dlx shadcn@latest add navigation-menu
```

---

### Pagination

分页器。

```
安装: pnpm dlx shadcn@latest add pagination
```

**何时使用**: 日志列表分页、SFTP 大目录分页。

---

### Tabs

标签页切换。**本项目已在 `components/ui/tabs.tsx`**。

```
安装: pnpm dlx shadcn@latest add tabs
```

**何时使用**: 设置对话框 Tab 切换、终端/SFTP 视图切换。

**子组件**:

| 组件          | 用途         |
| ------------- | ------------ |
| `TabsList`    | 标签列表容器 |
| `TabsTrigger` | 单个标签     |
| `TabsContent` | 标签对应内容 |

**示例**:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
;<Tabs defaultValue="general">
  <TabsList>
    <TabsTrigger value="general">General</TabsTrigger>
    <TabsTrigger value="terminal">Terminal</TabsTrigger>
  </TabsList>
  <TabsContent value="general">General settings</TabsContent>
  <TabsContent value="terminal">Terminal settings</TabsContent>
</Tabs>
```

---

## 5. 数据展示（Data Display）

### Aspect Ratio

保持元素宽高比。

```
安装: pnpm dlx shadcn@latest add aspect-ratio
```

**何时使用**: 图片容器、视频容器。

---

### Avatar

头像/图标。

```
安装: pnpm dlx shadcn@latest add avatar
```

**何时使用**: 用户头像、日志中显示操作用户。

**子组件**: `Avatar`、`AvatarImage`、`AvatarFallback`

**示例**:

```tsx
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
;<Avatar>
  <AvatarImage src="https://..." />
  <AvatarFallback>ZL</AvatarFallback>
</Avatar>
```

---

### Badge

徽章/标签。

```
安装: pnpm dlx shadcn@latest add badge
```

**何时使用**: 主机协议标签（SSH/SFTP）、状态徽章（在线/离线）、标签分类。

**示例**:

```tsx
import { Badge } from "@/components/ui/badge";

<Badge variant="outline">SSH</Badge>
<Badge variant="secondary">Connected</Badge>
```

---

### Card

卡片容器。**本项目已在 `components/ui/card.tsx`**。

```
安装: pnpm dlx shadcn@latest add card
```

**何时使用**: 主机卡片、Snippets 列表项、设置项卡片。

**子组件**: `Card`、`CardHeader`、`CardTitle`、`CardDescription`、`CardContent`、`CardFooter`

**示例**:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
;<Card>
  <CardHeader>
    <CardTitle>腾讯云4h4g1y</CardTitle>
    <CardDescription>ssh, ubuntu</CardDescription>
  </CardHeader>
  <CardContent>
    <Badge>SSH</Badge>
  </CardContent>
</Card>
```

---

### Data Table

带排序、筛选、分页的数据表格。

```
安装: pnpm dlx shadcn@latest add data-table
```

**何时使用**: Known Hosts 列表、日志列表、Snippets 列表。

---

### Empty

空状态占位。

```
安装: pnpm dlx shadcn@latest add empty
```

**何时使用**: 无主机时、无日志时、无 Snippets 时的占位提示。**替代自定义空状态 div**。

**示例**:

```tsx
import { Empty } from '@/components/ui/empty'
;<Empty description="No hosts yet. Add your first host to get started.">
  <Button>Add Host</Button>
</Empty>
```

---

### Kbd

键盘按键样式。

```
安装: pnpm dlx shadcn@latest add kbd
```

**何时使用**: 快捷键提示（`⌘N`、`Ctrl+T`）。

**示例**:

```tsx
import { Kbd } from '@/components/ui/kbd'
;<Kbd>⌘N</Kbd>
```

---

### Skeleton

加载占位骨架屏。

```
安装: pnpm dlx shadcn@latest add skeleton
```

**何时使用**: 主机列表加载中、终端连接中状态。**替代自定义 `animate-pulse` div**。

**示例**:

```tsx
import { Skeleton } from '@/components/ui/skeleton'
;<Skeleton className="h-4 w-[200px]" />
```

---

### Table

表格。**基于原生 `<table>` 的样式封装**。

```
安装: pnpm dlx shadcn@latest add table
```

**何时使用**: SFTP 文件列表、日志表格、Known Hosts 列表。

**子组件**: `Table`、`TableHeader`、`TableBody`、`TableRow`、`TableHead`、`TableCell`

**示例**:

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
;<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Size</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>project</TableCell>
      <TableCell>--</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

---

### Typography

排版预设（h1-h6、p、blockquote、code）。

```
安装: pnpm dlx shadcn@latest add typography
```

---

## 6. 代码（Code）

### Command

命令面板/搜索框，类似于 Spotlight 风格。

```
安装: pnpm dlx shadcn@latest add command
```

**何时使用**: 全局命令面板（`⌘J`）、SSH 命令搜索、Snippet 搜索。

**子组件**: `Command`、`CommandDialog`、`CommandInput`、`CommandList`、`CommandGroup`、`CommandItem`

**示例**:

```tsx
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command'
;<Command>
  <CommandInput placeholder="Type a command or search..." />
  <CommandList>
    <CommandEmpty>No results found.</CommandEmpty>
    <CommandGroup heading="Snippets">
      <CommandItem>pm2 delete 2</CommandItem>
      <CommandItem>pnpm dev</CommandItem>
    </CommandGroup>
  </CommandList>
</Command>
```

---

## 7. 时间/日历（Time & Calendar）

### Calendar

日历组件。

```
安装: pnpm dlx shadcn@latest add calendar
```

**何时使用**: 日志按日期筛选、计划任务。

---

## 8. 设备框架（Device Mocks）

### Resizable

可调节大小的面板/列。

```
安装: pnpm dlx shadcn@latest add resizable
```

**何时使用**: SFTP 左右双栏可调节宽度、终端 + 侧边栏可调节。

---

## 9. 可视化（Visualization）

### Chart

基于 Recharts 的图表组件。

```
安装: pnpm dlx shadcn@latest add chart
```

---

## 10. 布局（Layout）

### Resizable

见上方"设备框架"。

---

### Separator

见上方"交互"。

---

## 11. 媒体（Media）

### Avatar

见上方"数据展示"。

---

## 12. 特殊效果（Special Effects）

### Toggle

见上方"交互"。

---

## 13. 金融（Finance）

暂无对应组件。

---

## 14. 文本与反馈（Text & Feedback）

### Alert

见上方"交互"。

### Badge

见上方"数据展示"。

### Empty

见上方"数据展示"。

### Progress

见上方"交互"。

### Skeleton

见上方"数据展示"。

### Sonner

Toast 通知（全局弹出提示）。

```
安装: pnpm dlx shadcn@latest add sonner
```

**何时使用**: 操作成功/失败提示、连接状态通知。**替代 alert() 和自定义 toast**。

**示例**:

```tsx
import { toast } from 'sonner'

toast.success('Host saved successfully')
toast.error('Failed to connect')
toast('Host deleted', { description: 'The host has been removed.' })
```

> **注意**: Sonner 使用方式为 `toast()` 函数调用，不需要组件嵌入。

---

### Spinner

加载指示器。

```
安装: pnpm dlx shadcn@latest add spinner
```

---

### Toast

基于 Toast 组件的通知（与 Sonner 二选一）。

```
安装: pnpm dlx shadcn@latest add toast
```

---

## 快速参考表

| 需求       | 组件           | 安装命令                                  |
| ---------- | -------------- | ----------------------------------------- |
| 按钮       | `Button`       | 已安装                                    |
| 输入框     | `Input`        | 已安装                                    |
| 下拉选择   | `Select`       | 已安装                                    |
| 文本域     | `Textarea`     | 已安装                                    |
| 对话框     | `Dialog`       | 已安装                                    |
| 标签页     | `Tabs`         | 已安装                                    |
| 卡片       | `Card`         | 已安装                                    |
| 下拉菜单   | `DropdownMenu` | 已安装                                    |
| 表单标签   | `Label`        | 已安装                                    |
| Toast 通知 | `Sonner`       | `pnpm dlx shadcn@latest add sonner`       |
| 侧边抽屉   | `Sheet`        | `pnpm dlx shadcn@latest add sheet`        |
| 命令面板   | `Command`      | `pnpm dlx shadcn@latest add command`      |
| 确认对话框 | `AlertDialog`  | `pnpm dlx shadcn@latest add alert-dialog` |
| 分割线     | `Separator`    | `pnpm dlx shadcn@latest add separator`    |
| 开关       | `Switch`       | `pnpm dlx shadcn@latest add switch`       |
| 表格       | `Table`        | `pnpm dlx shadcn@latest add table`        |
| 头像       | `Avatar`       | `pnpm dlx shadcn@latest add avatar`       |
| 徽章       | `Badge`        | `pnpm dlx shadcn@latest add badge`        |
| 加载骨架   | `Skeleton`     | `pnpm dlx shadcn@latest add skeleton`     |
| 键盘按键   | `Kbd`          | `pnpm dlx shadcn@latest add kbd`          |
| 空状态     | `Empty`        | `pnpm dlx shadcn@latest add empty`        |
| 工具提示   | `Tooltip`      | `pnpm dlx shadcn@latest add tooltip`      |
| 可拖拽列   | `Resizable`    | `pnpm dlx shadcn@latest add resizable`    |
| 面包屑     | `Breadcrumb`   | `pnpm dlx shadcn@latest add breadcrumb`   |
| 分页       | `Pagination`   | `pnpm dlx shadcn@latest add pagination`   |
| 进度条     | `Progress`     | `pnpm dlx shadcn@latest add progress`     |
| 滑动输入   | `Slider`       | `pnpm dlx shadcn@latest add slider`       |
| 复选框     | `Checkbox`     | `pnpm dlx shadcn@latest add checkbox`     |
| 单选组     | `RadioGroup`   | `pnpm dlx shadcn@latest add radio-group`  |
| 滚动区     | `ScrollArea`   | `pnpm dlx shadcn@latest add scroll-area`  |
| 折叠面板   | `Accordion`    | `pnpm dlx shadcn@latest add accordion`    |
| 手风琴提示 | `Alert`        | `pnpm dlx shadcn@latest add alert`        |
| 输入组     | `InputGroup`   | `pnpm dlx shadcn@latest add input-group`  |
| 可折叠     | `Collapsible`  | `pnpm dlx shadcn@latest add collapsible`  |
| Popover    | `Popover`      | `pnpm dlx shadcn@latest add popover`      |
| Hover Card | `HoverCard`    | `pnpm dlx shadcn@latest add hover-card`   |
| 日期选择   | `DatePicker`   | `pnpm dlx shadcn@latest add date-picker`  |
| 日历       | `Calendar`     | `pnpm dlx shadcn@latest add calendar`     |
| Toggle     | `Toggle`       | `pnpm dlx shadcn@latest add toggle`       |

---

_文档更新时间: 2026-03-19_
