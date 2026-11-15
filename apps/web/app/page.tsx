"use client";

import { useEffect } from "react";
import { Centered } from "@/components/custom/centered";
import { Spinner } from "@/components/custom/spinner";
import { appRoute, useNavigation } from "@/lib/navigation";

export default function HomePage() {
  const navigation = useNavigation();

  useEffect(() => {
    navigation.replace(appRoute.organizations());
  }, [navigation]);

  return (
    <Centered variant="screen">
      <Spinner size="large" text="Loading…" />
    </Centered>
  );
}
