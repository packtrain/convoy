"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Centered } from "@/components/custom/centered";
import { SignedInAsNote } from "@/components/blocks/auth/signed-in-as-note";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { targetFromHref, useNavigation } from "@/lib/navigation";
import { getErrorMessage } from "@/lib/errors";

const CODE_LENGTH = 8;

/**
 * Code-entry page for the CLI browser-login flow (device path, for
 * devcontainers/headless hosts). A matching code redirects to the shared
 * /cli-login approve page. See docs/specs/cli-browser-login.md.
 */
export default function DeviceCodePage() {
  const navigation = useNavigation();
  const lookup = useMutation(api.cli.login.lookupByUserCode);

  const [code, setCode] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const submitCode = async (value: string) => {
    if (value.length !== CODE_LENGTH || isLookingUp) return;

    setIsLookingUp(true);
    setErrorMessage("");
    try {
      // The server normalizes (uppercases, re-inserts the dash).
      const request = await lookup({ userCode: value });
      if (!request) {
        setErrorMessage("Code not found or expired. Check the code in your terminal.");
        return;
      }
      navigation.push(
        targetFromHref(`/cli-login?challenge=${encodeURIComponent(request.challengeId)}`)
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Lookup failed"));
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitCode(code);
  };

  return (
    <Centered variant="screen" className="bg-background p-4">
      <Card className="w-full max-w-md gap-8 px-4 py-10">
        <CardHeader className="text-center">
          <CardTitle>Connect a device</CardTitle>
          <CardDescription>
            Enter the code shown in your terminal to approve the CLI login.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4 text-center">
            <InputOTP
              autoFocus
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(value) => setCode(value.toUpperCase())}
              onComplete={(value: string) => void submitCode(value)}
              pattern="^[a-zA-Z0-9]+$"
              pasteTransformer={(pasted) => pasted.replace(/[^a-zA-Z0-9]/g, "")}
              disabled={isLookingUp}
              aria-label="Device code"
              containerClassName="justify-center"
            >
              <InputOTPGroup className="font-mono">
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup className="font-mono">
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
                <InputOTPSlot index={6} />
                <InputOTPSlot index={7} />
              </InputOTPGroup>
            </InputOTP>
            {errorMessage && (
              <p className="text-sm text-destructive text-center">{errorMessage}</p>
            )}
            <Button
              type="submit"
              className="w-full cursor-pointer"
              disabled={code.length !== CODE_LENGTH || isLookingUp}
            >
              {isLookingUp ? "Checking..." : "Continue"}
            </Button>
            <SignedInAsNote />
          </form>
        </CardContent>
      </Card>
    </Centered>
  );
}
