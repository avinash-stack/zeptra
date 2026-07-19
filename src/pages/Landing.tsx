import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Menu, X, CheckCircle, Receipt, ShieldCheck, GitBranch, 
  Tag, BarChart2, Smartphone, Building2, Mail, CheckSquare,
  ArrowRight
} from 'lucide-react';
import { appUrl } from '@/lib/domains';

/** Always navigates to the app domain via full-page load */
const AppLink = React.forwardRef<HTMLAnchorElement, { to: string, children?: React.ReactNode, className?: string, onClick?: () => void }>(({ to, children, ...props }, ref) => {
  return <a href={appUrl(to)} ref={ref} {...props}>{children}</a>;
});
AppLink.displayName = 'AppLink';

const Landing: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* 1. STICKY HEADER / NAV */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center">
            <img src="/zeptra-logo.png" alt="Zeptra Logo" className="h-10 w-auto max-w-[140px] object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement)?.classList.remove('hidden'); }} />
            <span className="hidden text-xl font-bold text-foreground">Zeptra</span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
          </nav>

          <div className="hidden md:flex items-center gap-4">
            <Button variant="ghost" asChild className="text-foreground">
              <AppLink to="/login">Login</AppLink>
            </Button>
            <Button asChild className="bg-primary text-white hover:bg-primary/90">
              <AppLink to="/create-organization">Get started free</AppLink>
            </Button>
          </div>

          <button 
            className="md:hidden p-2 text-foreground"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile menu with animation */}
        <div
          className={`md:hidden border-t border-border bg-background px-4 shadow-lg overflow-hidden transition-all duration-300 ease-in-out ${
            mobileMenuOpen ? 'max-h-80 py-4 opacity-100' : 'max-h-0 py-0 opacity-0'
          }`}
        >
          <div className="space-y-4">
            <a href="#features" className="block text-sm font-medium text-foreground p-2" onClick={() => setMobileMenuOpen(false)}>Features</a>
            <a href="#how-it-works" className="block text-sm font-medium text-foreground p-2" onClick={() => setMobileMenuOpen(false)}>How it works</a>
            <a href="#pricing" className="block text-sm font-medium text-foreground p-2" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
            <div className="pt-4 flex flex-col gap-2">
              <Button variant="outline" asChild className="w-full">
                <AppLink to="/login">Login</AppLink>
              </Button>
              <Button asChild className="w-full bg-primary text-white hover:bg-primary/90">
                <AppLink to="/create-organization">Get started free</AppLink>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main>
        {/* 2. HERO SECTION */}
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
          <div className="lg:flex lg:items-center lg:gap-12">
            <div className="flex-1 text-center lg:text-left animate-fade-in-up">
              <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-6">
                Built for Indian SMBs &amp; growing teams
              </div>
              <h1 className="text-5xl md:text-7xl font-extrabold leading-tight text-foreground max-w-4xl mx-auto lg:mx-0 tracking-tight">
                Expense management your team will actually use
              </h1>
              <p className="mt-6 text-xl text-muted-foreground max-w-2xl mx-auto lg:mx-0">
                Submit receipts, route approvals, and track spend — all in one invite-only workspace. No per-seat pricing surprises.
              </p>
              
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                <Button asChild size="lg" className="h-14 px-8 bg-gradient-to-r from-primary to-accent text-white hover:opacity-90 text-lg w-full sm:w-auto shadow-lg shadow-primary/25">
                  <AppLink to="/create-organization">Create your organization</AppLink>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-14 px-8 text-lg w-full sm:w-auto border-border hover:bg-muted">
                  <AppLink to="/login">Login to existing org</AppLink>
                </Button>
              </div>

              <div className="mt-8 flex flex-wrap justify-center lg:justify-start gap-4 text-sm text-muted-foreground font-medium">
                <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-primary" /> Free to start</span>
                <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-primary" /> Invite-only access</span>
                <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-primary" /> 2-level approval workflow</span>
              </div>
            </div>

            {/* Hero Visual: Inline Mock Expense Card */}
            <div className="mt-16 lg:mt-0 flex-1 flex justify-center lg:justify-end animate-fade-in-up animation-delay-200">
              <div className="relative w-full max-w-md bg-card border border-border rounded-2xl p-6 shadow-2xl shadow-foreground/5 transform rotate-2 hover:rotate-0 transition-transform duration-300">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="font-semibold text-lg text-foreground">Travel to Mumbai</h3>
                    <p className="text-3xl font-bold text-foreground mt-1">₹4,500</p>
                  </div>
                  <span className="bg-warning/10 text-warning border border-warning/20 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
                    Pending L1
                  </span>
                </div>
                
                <div className="flex items-center gap-3 mb-6 p-3 rounded-lg bg-muted/50 border border-border/50">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-bold text-sm shadow-inner">
                    RS
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Ravi Sharma</p>
                    <p className="text-xs text-muted-foreground">Manager</p>
                  </div>
                </div>

                {/* Progress bar — fixed z-index */}
                <div className="relative pt-2">
                  <div className="absolute top-1/2 left-0 w-full h-0.5 bg-border translate-y-[-50%]"></div>
                  <div className="absolute top-1/2 left-0 w-1/3 h-0.5 bg-primary translate-y-[-50%]"></div>
                  
                  <div className="flex justify-between relative z-10">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center ring-4 ring-card">
                        <CheckCircle className="w-3.5 h-3.5 text-white" />
                      </div>
                      <span className="text-xs font-medium text-foreground">Submit</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-card border-2 border-primary flex items-center justify-center ring-4 ring-card shadow-sm">
                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                      </div>
                      <span className="text-xs font-medium text-primary">L1 Apprv</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-card border-2 border-border flex items-center justify-center ring-4 ring-card"></div>
                      <span className="text-xs font-medium text-muted-foreground">L2 Apprv</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. SOCIAL PROOF STRIP */}
        <section className="bg-muted/40 py-12 border-y border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-medium text-muted-foreground text-center mb-8 uppercase tracking-widest">
              Trusted by teams who outgrew spreadsheets
            </p>
            <div className="flex flex-wrap justify-center md:justify-between gap-8 text-center">
              <div className="flex-1 min-w-[200px]">
                <p className="text-3xl font-semibold text-foreground mb-1">500+</p>
                <p className="text-sm text-muted-foreground">expenses processed</p>
              </div>
              <div className="flex-1 min-w-[200px]">
                <p className="text-3xl font-semibold text-foreground mb-1">3-min</p>
                <p className="text-sm text-muted-foreground">avg approval time</p>
              </div>
              <div className="flex-1 min-w-[200px]">
                <p className="text-3xl font-semibold text-foreground mb-1">2-level</p>
                <p className="text-sm text-muted-foreground">approval workflow</p>
              </div>
              <div className="flex-1 min-w-[200px]">
                <p className="text-3xl font-semibold text-foreground mb-1">₹ INR</p>
                <p className="text-sm text-muted-foreground">native support</p>
              </div>
            </div>
          </div>
        </section>

        {/* 4. FEATURES SECTION */}
        <section id="features" className="py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 animate-fade-in-up">
            <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-6">Everything finance teams need</h2>
            <p className="text-xl text-muted-foreground">
              No training required. Roles, rules, and receipts — handled natively.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: Receipt,
                title: "Receipt to approval in 3 clicks",
                desc: "Employees submit expenses with a receipt upload. Managers get notified instantly. Finance sees everything in one view."
              },
              {
                icon: ShieldCheck,
                title: "Role-based access, out of the box",
                desc: "Admin, Finance, HR, Employee — each role sees only what they need. Invite-only means no unauthorized access."
              },
              {
                icon: GitBranch,
                title: "2-level approval workflow",
                desc: "L1 manager approves, L2 escalates automatically. Full audit trail on every decision with comments."
              },
              {
                icon: Tag,
                title: "Org-scoped categories & currencies",
                desc: "Create expense categories for your org. Set INR as default or add multiple currencies for global teams."
              },
              {
                icon: BarChart2,
                title: "Finance dashboard & exports",
                desc: "Monthly trends, status breakdowns, and top spenders. Export to CSV for QuickBooks or Tally."
              },
              {
                icon: Smartphone,
                title: "Works on any device",
                desc: "Mobile-first design. Submit expenses right after they happen — no waiting until end of month."
              }
            ].map((feature, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-8 hover:shadow-lg hover:border-primary/20 transition-all duration-300 group">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-3">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 5. HOW IT WORKS */}
        <section id="how-it-works" className="py-24 bg-muted/20 border-y border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl md:text-5xl font-bold text-center text-foreground mb-16 animate-fade-in-up">Up and running in 5 minutes</h2>
            
            <div className="relative flex flex-col md:flex-row gap-12 md:gap-8 justify-between">
              {/* Connecting line (desktop) */}
              <div className="hidden md:block absolute top-1/2 left-[15%] right-[15%] h-0.5 border-t-2 border-dashed border-border translate-y-[-16px]"></div>

              <div className="flex-1 relative bg-background rounded-2xl pt-12 pb-8 px-8 border border-border shadow-sm text-center">
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-5xl font-black text-primary/10 select-none pointer-events-none">01</div>
                <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-6 border-4 border-background relative z-10">
                  <Building2 className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Create your org workspace</h3>
                <p className="text-muted-foreground">Setup your brand, default currency, and basic settings in seconds.</p>
              </div>

              <div className="flex-1 relative bg-background rounded-2xl pt-12 pb-8 px-8 border border-border shadow-sm text-center">
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-5xl font-black text-primary/10 select-none pointer-events-none">02</div>
                <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-6 border-4 border-background relative z-10">
                  <Mail className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Invite your team by email</h3>
                <p className="text-muted-foreground">Assign roles and L1 managers securely via custom email invites.</p>
              </div>

              <div className="flex-1 relative bg-background rounded-2xl pt-12 pb-8 px-8 border border-border shadow-sm text-center">
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-5xl font-black text-primary/10 select-none pointer-events-none">03</div>
                <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-6 border-4 border-background relative z-10">
                  <CheckSquare className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Start submitting & approving</h3>
                <p className="text-muted-foreground">Watch expenses flow through the automated approval pipeline.</p>
              </div>
            </div>
          </div>
        </section>

        {/* 6. PRICING TEASER */}
        <section id="pricing" className="py-24 bg-muted/40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-4">Simple pricing. No surprises.</h2>
              <p className="text-xl text-muted-foreground">Start free, upgrade when your team grows.</p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
              {/* Free Card */}
              <div className="bg-card border border-border rounded-2xl p-8 flex flex-col shadow-sm">
                <h3 className="text-2xl font-bold text-foreground mb-2">Free forever</h3>
                <div className="flex items-baseline gap-2 mb-6">
                  <span className="text-4xl font-extrabold text-foreground">₹0</span>
                  <span className="text-muted-foreground font-medium">/ month</span>
                </div>
                <ul className="space-y-4 mb-8 flex-1">
                  {['Up to 5 users', '50 expenses/month', '2-level approvals', 'Email notifications'].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-foreground font-medium">
                      <CheckCircle className="w-5 h-5 text-primary shrink-0" /> {item}
                    </li>
                  ))}
                </ul>
                <Button asChild variant="outline" size="lg" className="w-full h-12 text-base border-border hover:bg-muted">
                  <AppLink to="/create-organization">Get started</AppLink>
                </Button>
              </div>

              {/* Pro Card */}
              <div className="bg-card border-2 border-primary rounded-2xl p-8 flex flex-col shadow-xl relative">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border border-primary/20">
                  Most popular
                </div>
                <h3 className="text-2xl font-bold text-foreground mb-2">Pro</h3>
                <div className="flex items-baseline gap-2 mb-6">
                  <span className="text-4xl font-extrabold text-foreground">₹999</span>
                  <span className="text-muted-foreground font-medium">/ month</span>
                </div>
                <ul className="space-y-4 mb-8 flex-1">
                  {['Everything in Free', 'Unlimited users', 'Unlimited expenses', 'Analytics dashboard', 'Priority support'].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-foreground font-medium">
                      <CheckCircle className="w-5 h-5 text-primary shrink-0" /> {item}
                    </li>
                  ))}
                </ul>
                <Button asChild size="lg" className="w-full h-12 bg-primary text-white hover:bg-primary/90 text-base shadow-lg shadow-primary/25">
                  <AppLink to="/create-organization">Start free trial</AppLink>
                </Button>
              </div>

              {/* Enterprise Card */}
              <div className="bg-card border border-border rounded-2xl p-8 flex flex-col shadow-sm">
                <h3 className="text-2xl font-bold text-foreground mb-2">Enterprise</h3>
                <div className="flex items-baseline gap-2 mb-6">
                  <span className="text-4xl font-extrabold text-foreground">Custom</span>
                </div>
                <ul className="space-y-4 mb-8 flex-1">
                  {['Everything in Pro', 'Unlimited users', 'Tally & CSV export', 'API access', 'Dedicated account manager', 'Custom integrations', 'SLA'].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-foreground font-medium">
                      <CheckCircle className="w-5 h-5 text-primary shrink-0" /> {item}
                    </li>
                  ))}
                </ul>
                <Button asChild variant="outline" size="lg" className="w-full h-12 text-base border-border hover:bg-muted">
                  <AppLink to="/create-organization">Contact sales</AppLink>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* 7. FINAL CTA SECTION */}
        <section className="py-24 px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl bg-gradient-to-br from-primary to-accent rounded-3xl p-12 md:p-16 text-center shadow-2xl shadow-primary/20 relative overflow-hidden">
            <div className="absolute inset-0 opacity-20">
              <div className="absolute top-0 left-0 w-72 h-72 bg-white/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
              <div className="absolute bottom-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl translate-x-1/3 translate-y-1/3"></div>
            </div>
            <div className="relative z-10">
              <h2 className="text-3xl md:text-5xl font-bold text-white mb-6 leading-tight">
                Ready to replace your expense spreadsheet?
              </h2>
              <p className="text-xl text-white/80 mb-10 max-w-2xl mx-auto font-medium">
                Set up your org in 5 minutes. First 5 users free.
              </p>
              <Button asChild size="lg" className="h-14 px-10 bg-white text-primary hover:bg-white/90 text-lg font-bold shadow-xl">
                <AppLink to="/create-organization">
                  Create your organization
                </AppLink>
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* 8. FOOTER */}
      <footer className="border-t border-border bg-background py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <img src="/zeptra-logo.png" alt="Zeptra Logo" className="h-6 w-auto max-w-[100px] grayscale opacity-70 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement)?.classList.remove('hidden'); }} />
            <span className="hidden text-sm font-semibold text-muted-foreground">Zeptra</span>
          </div>
          
          <div className="text-sm text-muted-foreground text-center md:text-left">
            © {new Date().getFullYear()} Zeptra. All rights reserved.
          </div>

          <div className="flex gap-6 text-sm text-muted-foreground">
            <span className="cursor-default">Privacy</span>
            <span className="cursor-default">Terms</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
