"use client";

import { DateTimePicker } from "@/components/lingua-time/datetime-picker";
import { useState } from "react";

export default function CalendarSelector() {
  const [dateTime, setDateTime] = useState<Date | undefined>(new Date());
  return (
    <div className="p-4 max-w-md flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Auto locale (default)</p>
      <DateTimePicker
        dateTime={dateTime}
        setDateTime={setDateTime}
        autoComplete="off"
      />

      <p className="text-sm text-muted-foreground">Date only mode</p>
      <DateTimePicker
        dateTime={dateTime}
        setDateTime={setDateTime}
        mode="date"
        autoComplete="off"
      />

      <p className="text-sm text-muted-foreground">Icon on left, popover bottom-start</p>
      <DateTimePicker
        dateTime={dateTime}
        setDateTime={setDateTime}
        iconPosition="left"
        popoverSide="bottom"
        popoverAlign="start"
        autoComplete="off"
        mode="date"
      />

      <p className="text-sm text-muted-foreground">en-GB locale, popover left</p>
      <DateTimePicker
        dateTime={dateTime}
        setDateTime={setDateTime}
        locale="en-GB"
        popoverSide="left"
        autoComplete="off"
      />

      <p className="text-sm text-muted-foreground">en-US locale</p>
      <DateTimePicker
        dateTime={dateTime}
        setDateTime={setDateTime}
        locale="en-US"
        autoComplete="off"
      />
    </div>
  );
}
