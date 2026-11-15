"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { Slot } from "radix-ui"
import { RemoveScroll } from "react-remove-scroll"
import * as chrono from "chrono-node"
import { CalendarDays } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { DateTimePickerPopover } from "./datetime-picker-popover"
import {
  generateDate,
  generateDateString,
  generateDateTriggerString,
  isDateOverdue,
  isValidDateFormat,
  type DateTimeLocale,
} from "./datetime-utils"

export type { DateTimeLocale, DateTimePickerVariant }

const defaultSuggestions = [
  "Tomorrow",
  // "Tomorrow morning",
  // "Tomorrow night",
  "Next Monday",
  "Next Friday",
  "Next Month",
]

const overdueDateClassName = "text-amber-900 dark:text-amber-100"
const overdueDateIconClassName = "text-amber-600 dark:text-amber-400"
const overdueDateSurfaceClassName =
  "bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50"

function generateSuggestions(
  inputValue: string,
  suggestion: Suggestion | null
): Suggestion[] {
  if (!inputValue.length) {
    return defaultSuggestions
      .map((suggestion) => ({
        date: generateDate(suggestion),
        inputString: suggestion,
      }))
      .filter((s): s is Suggestion => s.date !== null)
  }

  const filteredDefaultSuggestions = defaultSuggestions.filter((suggestion) =>
    suggestion.toLowerCase().includes(inputValue.toLowerCase())
  )
  if (filteredDefaultSuggestions.length) {
    return filteredDefaultSuggestions
      .map((suggestion) => ({
        date: generateDate(suggestion),
        inputString: suggestion,
      }))
      .filter((s): s is Suggestion => s.date !== null)
  }

  return [suggestion].filter((suggestion) => suggestion !== null)
}

interface Suggestion {
  date: Date
  inputString: string
}

type DateTimePickerVariant = "default" | "ghost" | "icon" | "icon-or-date" | "compact"

interface DateTimePickerProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  dateTime: Date | undefined
  setDateTime: React.Dispatch<React.SetStateAction<Date | undefined>>
  mode?: "date" | "datetime"
  locale?: DateTimeLocale
  popoverSide?: "top" | "right" | "bottom" | "left"
  popoverAlign?: "start" | "center" | "end"
  iconPosition?: "left" | "right"
  /** Display variant: default (bordered input), ghost (borderless input), icon (icon-only trigger), icon-or-date (icon when empty, compact date pill when set) */
  variant?: DateTimePickerVariant
  /** Whether the date can be edited from this control. Read-only compact variants render display-only output. */
  isEditable?: boolean
  /** Custom date format string (date-fns format). E.g., "dd/MM/yyyy" or "MM-dd-yyyy" */
  dateFormat?: string
}

export const DateTimePicker = forwardRef<HTMLInputElement, DateTimePickerProps>(
  (
    {
      dateTime,
      setDateTime,
      mode = "datetime",
      locale,
      popoverSide,
      popoverAlign,
      iconPosition = "right",
      variant = "default",
      isEditable = true,
      dateFormat,
      placeholder = "Set date",
      disabled,
      ...props
    },
    ref
  ) => {
    const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
    const [inputValue, setInputValue] = useState(() =>
      dateTime ? generateDateString(dateTime, mode, locale, dateFormat) : ""
    )
    const [isOpen, setIsOpen] = useState(false)
    // Disabling (e.g. losing write access) closes open suggestions.
    if (disabled && isOpen) {
      setIsOpen(false)
    }
    const [isClosing, setClosing] = useState(false)
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })

    const inputRef = useRef<HTMLInputElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const isEditingInputRef = useRef(false)

    useImperativeHandle(ref, () => inputRef.current!)

    // Update dropdown position when open
    useLayoutEffect(() => {
      if (isOpen && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setDropdownPosition({
          top: rect.bottom + window.scrollY + 8,
          left: rect.left + window.scrollX,
          width: rect.width,
        })
      }
    }, [isOpen])

    const suggestions = useMemo(
      () => isOpen ? generateSuggestions(inputValue, suggestion) : [],
      [isOpen, inputValue, suggestion]
    )
    const triggerLabel = dateTime
      ? generateDateTriggerString(dateTime, mode, locale)
      : null
    const isOverdue = dateTime ? isDateOverdue(dateTime) : false

    function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
      const nextInputValue = e.target.value

      isEditingInputRef.current = true
      setInputValue(nextInputValue)
      setIsOpen(true)
      setSelectedIndex(0)
      const result = chrono.parseDate(nextInputValue)
      if (result) {
        setSuggestion({ date: result, inputString: nextInputValue })
      } else {
        setSuggestion(null)
      }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((prevIndex) =>
          prevIndex < suggestions.length - 1 ? prevIndex + 1 : prevIndex
        )
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((prevIndex) => (prevIndex > 0 ? prevIndex - 1 : 0))
      } else if (e.key === "Enter" && isOpen && suggestions.length > 0) {
        e.preventDefault()
        const dateStr = generateDateString(suggestions[selectedIndex].date, mode, locale, dateFormat)
        setInputValue(dateStr)
        setDateTime(suggestions[selectedIndex].date)
        closeDropdown()
      } else if (e.key === "Escape" || e.key === "Tab") {
        closeDropdown()
      }
    }

    function closeDropdown() {
      setClosing(true)
      setSelectedIndex(0)
      setTimeout(() => {
        isEditingInputRef.current = false
        setIsOpen(false)
        setClosing(false)
        setDropdownPosition({ top: 0, left: 0, width: 0 })
      }, 200)
    }

    useEffect(() => {
      if (!isEditingInputRef.current) return
      if (!inputValue) setDateTime(undefined)
      else if (!isValidDateFormat(inputValue, mode, dateFormat)) setDateTime(undefined)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inputValue, mode, dateFormat])

    useEffect(() => {
      if (isOpen) return

      const nextInputValue = dateTime
        ? generateDateString(dateTime, mode, locale, dateFormat)
        : ""

      setInputValue((currentInputValue) =>
        currentInputValue === nextInputValue ? currentInputValue : nextInputValue
      )
    }, [dateTime, mode, locale, dateFormat, isOpen])

    useEffect(() => {
      function handleClickOutside(e: MouseEvent) {
        if (
          dropdownRef.current &&
          !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current &&
          !inputRef.current.contains(e.target as Node)
        ) {
          closeDropdown()
        }
      }

      document.addEventListener("mousedown", handleClickOutside)

      return () => {
        document.removeEventListener("mousedown", handleClickOutside)
      }
    }, [])

    // Compact trigger variants - render as an icon or a compact date pill
    if (variant === "compact" && !isEditable) {
      if (!triggerLabel) {
        return null
      }

      return (
        <span
          title={`Due date: ${triggerLabel}`}
          className={cn(
            "inline-flex items-center rounded px-1.5 py-0.5 text-xs",
            isOverdue ? overdueDateSurfaceClassName : "bg-muted text-muted-foreground",
            props.className
          )}
        >
          {triggerLabel}
        </span>
      )
    }

    if (variant === "icon" || variant === "icon-or-date" || variant === "compact") {
      const isValueTrigger = variant === "icon-or-date" && triggerLabel !== null
      const isCompact = variant === "compact"
      const shouldShowValue = (isValueTrigger || isCompact) && triggerLabel !== null
      const triggerAriaLabel = props["aria-label"] ?? triggerLabel ?? placeholder

      return (
        <DateTimePickerPopover
          onOpen={() => setSuggestion(null)}
          dateTime={dateTime}
          setDateTime={setDateTime}
          setInputValue={setInputValue}
          mode={mode}
          locale={locale}
          popoverSide={popoverSide}
          popoverAlign={popoverAlign}
          dateFormat={dateFormat}
          disabled={disabled || !isEditable}
        >
          <Button
            size={shouldShowValue ? "sm" : "icon"}
            variant="ghost"
            disabled={disabled || !isEditable}
            aria-label={triggerAriaLabel}
            className={cn(
              shouldShowValue
                ? "h-8 px-2.5 text-xs font-medium text-foreground"
                : "size-8 text-muted-foreground",
              shouldShowValue &&
                (isOverdue
                  ? overdueDateSurfaceClassName
                  : "bg-muted hover:bg-muted/80"),
              isCompact &&
                (shouldShowValue
                  ? "h-5 rounded px-1.5 py-0 text-xs font-normal"
                  : "size-5 p-0 text-muted-foreground/40 hover:text-foreground"),
              isCompact && shouldShowValue && !isOverdue && "text-muted-foreground",
              props.className
            )}
          >
            {shouldShowValue ? (
              <span>{triggerLabel}</span>
            ) : (
              <>
                <span className="sr-only">{triggerAriaLabel}</span>
                <CalendarDays className="h-4 w-4" />
              </>
            )}
          </Button>
        </DateTimePickerPopover>
      )
    }

    return (
      <div ref={containerRef} className="relative">
        <div className="relative">
          <Input
            placeholder={placeholder}
            {...props}
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => !disabled && setIsOpen(true)}
            onClick={() => !disabled && setIsOpen(true)}
            disabled={disabled}
            className={cn(
              iconPosition === "left" ? "pl-9" : "pr-9",
              variant === "ghost" &&
                "border-0 bg-transparent dark:bg-transparent shadow-none focus-visible:ring-0 pl-7 pr-1.5 py-0 h-6!",
              isOverdue && overdueDateClassName,
              !disabled && "cursor-pointer",
              props.className
            )}
          />
          <DateTimePickerPopover
            onOpen={() => setSuggestion(null)}
            dateTime={dateTime}
            setDateTime={setDateTime}
            setInputValue={setInputValue}
            mode={mode}
            locale={locale}
            popoverSide={popoverSide}
            popoverAlign={popoverAlign}
            dateFormat={dateFormat}
            disabled={disabled}
          >
            <Button
              size="icon"
              variant="ghost"
              disabled={disabled}
              className={cn(
                "absolute top-1/2 size-4 -translate-y-1/2 rounded-sm text-muted-foreground",
                iconPosition === "left"
                  ? variant === "ghost" ? "left-1" : "left-3"
                  : "right-3",
                isOverdue && overdueDateIconClassName,
                !disabled && "cursor-pointer"
              )}
            >
              <span className="sr-only">Open date time picker</span>
              <CalendarDays />
            </Button>
          </DateTimePickerPopover>
        </div>

        {isOpen && suggestions.length > 0 && dropdownPosition.width > 0 && typeof document !== "undefined" &&
          createPortal(
            // Lifts an open dialog/drawer's scroll lock off this body portal (OS-2198).
            <RemoveScroll as={Slot.Root} noIsolation removeScrollBar={false} allowPinchZoom>
              <div
                ref={dropdownRef}
                role="dialog"
                className={cn(
                  "fixed z-50 rounded-md border bg-popover p-0 shadow-md transition-all animate-in fade-in-0 zoom-in-95 slide-in-from-top-2",
                  isClosing && "duration-300 animate-out fade-out-0 zoom-out-95"
                )}
                style={{
                  top: dropdownPosition.top,
                  left: dropdownPosition.left,
                  minWidth: Math.max(dropdownPosition.width, 280),
                }}
                tabIndex={-1}
                aria-label="Suggestions"
              >
                <ul
                  role="listbox"
                  aria-label="Suggestions"
                  className="max-h-56 overflow-auto p-1"
                >
                  {suggestions.map((suggestion, index) => (
                    <li
                      key={suggestion.inputString}
                      role="option"
                      aria-selected={selectedIndex === index}
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-1 rounded px-2.5 py-2 text-sm",
                        index === selectedIndex &&
                          "bg-accent text-accent-foreground"
                      )}
                      onClick={() => {
                        const dateStr = generateDateString(suggestion.date, mode, locale, dateFormat)
                        setInputValue(dateStr)
                        setDateTime(suggestion.date)
                        closeDropdown()
                        inputRef.current?.focus()
                      }}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <span className="w-[110px] truncate xs:w-auto">
                        {suggestion.inputString}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {generateDateString(suggestion.date, mode, locale, dateFormat)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </RemoveScroll>,
            document.body
          )}
      </div>
    )
  }
)

DateTimePicker.displayName = "DateTimePicker"
