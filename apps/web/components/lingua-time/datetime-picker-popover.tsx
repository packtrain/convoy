"use client"

import { useEffect, useState } from "react"

import { useMediaQuery } from "@/hooks/browser/use-media-query"
import { Calendar } from "@/components/ui/calendar"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

import { TimePicker } from "../time-picker/time-picker"
import { generateDateString, type DateTimeLocale } from "./datetime-utils"

interface DateTimePickerPopoverProps {
  children: React.ReactNode
  onOpen: () => void
  dateTime: Date | undefined
  setDateTime: React.Dispatch<React.SetStateAction<Date | undefined>>
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  mode?: "date" | "datetime"
  locale?: DateTimeLocale
  popoverSide?: "top" | "right" | "bottom" | "left"
  popoverAlign?: "start" | "center" | "end"
  /** Custom date format string (date-fns format) */
  dateFormat?: string
  /** Disable the popover trigger */
  disabled?: boolean
}

export function DateTimePickerPopover({
  children,
  onOpen,
  dateTime,
  setDateTime,
  setInputValue,
  mode = "datetime",
  locale,
  popoverSide = "right",
  popoverAlign = "center",
  dateFormat,
  disabled,
}: DateTimePickerPopoverProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const isDesktop = useMediaQuery("(min-width: 640px)")
  // Disabling (e.g. losing write access) closes a picker that was already open.
  if (disabled && (isPopoverOpen || isDrawerOpen)) {
    setIsPopoverOpen(false)
    setIsDrawerOpen(false)
  }
  // The drawer keeps its content mounted while it animates closed.
  const selectDateTime: typeof setDateTime = disabled ? () => {} : setDateTime

  useEffect(() => {
    setInputValue(dateTime ? generateDateString(dateTime, mode, locale, dateFormat) : "")
  }, [dateTime, setInputValue, mode, locale, dateFormat])

  if (!isDesktop) {
    return (
      <Drawer
        open={isDrawerOpen}
        onOpenChange={(value) => {
          if (disabled && value) return
          onOpen()
          setIsDrawerOpen(value)
        }}
        shouldScaleBackground
      >
        <DrawerTrigger asChild disabled={disabled}>{children}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="sr-only text-left">
            <DrawerTitle>Date Time Picker</DrawerTitle>
            <DrawerDescription>Select date and time</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col py-5">
            <Calendar
              mode="single"
              selected={dateTime}
              defaultMonth={dateTime}
              onSelect={selectDateTime}
              initialFocus
              className="self-center"
            />
            {mode !== "date" && (
              <div className="border-t border-border p-3">
                <TimePicker date={dateTime} setDate={selectDateTime} />
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover
      open={isPopoverOpen}
      onOpenChange={(value) => {
        if (disabled && value) return
        onOpen()
        setIsPopoverOpen(value)
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>{children}</PopoverTrigger>
      <PopoverContent align={popoverAlign} side={popoverSide} className="w-auto p-0">
        <Calendar
          mode="single"
          selected={dateTime}
          defaultMonth={dateTime}
          onSelect={selectDateTime}
          initialFocus
        />
        {mode !== "date" && (
          <div className="border-t border-border p-3">
            <TimePicker date={dateTime} setDate={selectDateTime} />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
