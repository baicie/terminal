'use client'

import { Label as LabelPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        // Safari/WebKit：@container + inline-flex 曾导致标签可用宽度过窄，中文被逐字换行
        'inline-flex w-max max-w-full shrink-0 flex-wrap items-center gap-2 text-sm leading-normal font-medium whitespace-normal select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
