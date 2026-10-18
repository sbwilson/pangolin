import { useNavigate } from "@tanstack/react-router";
import { PartnerSettings } from "../components/PartnerSettings.tsx";
import { SignInSecurity } from "../components/SignInSecurity.tsx";
import { Button } from "../components/ui/button.tsx";
import { useSignedIn } from "../session.tsx";

/** The signed-in home: who is signed in, notices, system status and account actions. */
export function HomePage() {
  const { me, signOut } = useSignedIn();
  const navigate = useNavigate();
  return (
    <>
      <p>
        Signed in as <strong>{me.displayName}</strong>
        {me.demo ? " (demo)" : null}
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={() => navigate({ to: "/transactions", replace: true })}
      >
        Transactions
      </Button>
      {me.demo ? null : (
        <div className="mt-6 flex flex-col gap-6">
          <SignInSecurity />
          <PartnerSettings />
        </div>
      )}
      {me.demo ? null : (
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      )}
    </>
  );
}
