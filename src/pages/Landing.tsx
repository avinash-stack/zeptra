import { Link } from "react-router-dom";
import { ArrowRight, Building2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const Landing: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-primary/5">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center px-6 py-16">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
          <Building2 className="h-3.5 w-3.5" />
          Zeptra Platform
        </div>

        <h1 className="max-w-4xl text-center text-4xl font-extrabold leading-tight text-foreground md:text-6xl">
          Expense Management For Modern Organizations
        </h1>

        <p className="mt-4 max-w-2xl text-center text-base text-muted-foreground md:text-lg">
          Set up your organization workspace, invite your team, and run approvals with role-based controls.
        </p>

        <div className="mt-10 flex w-full max-w-xl flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-12 flex-1 bg-gradient-to-r from-primary to-info text-base">
            <Link to="/create-organization">
              Create Organization
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 flex-1 text-base">
            <Link to="/login">Existing User Login</Link>
          </Button>
        </div>

        <div className="mt-14 grid w-full max-w-4xl gap-4 md:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="font-semibold">Org Setup</p>
            <p className="mt-1 text-sm text-muted-foreground">Create your company profile and workspace identity.</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="font-semibold">Invite-Only Access</p>
            <p className="mt-1 text-sm text-muted-foreground">Admins invite users and assign roles securely.</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="font-semibold">Approval Workflow</p>
            <p className="mt-1 text-sm text-muted-foreground">Track expenses, approvals, and organization spend.</p>
          </div>
        </div>

        <div className="mt-10 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Enterprise-ready role-based access
        </div>
      </div>
    </div>
  );
};

export default Landing;
