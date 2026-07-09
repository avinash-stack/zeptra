import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { useAuth } from '@/contexts/AuthContext';
import { usePlanLimit } from '@/hooks/usePlanLimit';
import { supabase } from '@/integrations/supabase/client';
import { Bell, User, Settings, HelpCircle, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import TrialBanner from '@/components/TrialBanner';
import TrialExpiredWall from '@/components/TrialExpiredWall';
import UpgradeModal from '@/components/UpgradeModal';

const AppLayout: React.FC = () => {
  const { profile, roles, signOut, organization } = useAuth();
  const { isTrialBlockRequired } = usePlanLimit();
  const navigate = useNavigate();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [orgCountry, setOrgCountry] = useState('IN');

  useEffect(() => {
    if (!organization?.id) return;
    supabase
      .from('organizations')
      .select('country')
      .eq('id', organization.id)
      .single()
      .then(({ data }) => {
        if (data && (data as any).country) setOrgCountry((data as any).country);
      });
  }, [organization?.id]);

  if (isTrialBlockRequired) {
    return (
      <>
        <TrialExpiredWall onUpgradeClick={() => setUpgradeOpen(true)} />
        <UpgradeModal
          open={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          country={orgCountry}
        />
      </>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full flex-col">
        <div className="px-4 pt-4 md:px-6">
          <TrialBanner onUpgradeClick={() => setUpgradeOpen(true)} />
        </div>
        <div className="flex flex-1 w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col">
            <header className="h-14 flex items-center justify-between border-b bg-card px-4">
              <div className="flex items-center gap-2">
                <SidebarTrigger />
                <h2 className="text-sm font-medium text-muted-foreground hidden sm:block">
                  {roles.length > 0 && (
                    <span className="capitalize">{roles[0]} Portal</span>
                  )}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon">
                  <Bell className="h-4 w-4" />
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-full p-0 overflow-hidden">
                      <div className="w-full h-full rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                        <span className="text-xs font-bold text-primary-foreground">
                          {profile?.name?.charAt(0)?.toUpperCase() || 'U'}
                        </span>
                      </div>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="font-normal">
                      <div>
                        <p className="text-sm font-medium">{profile?.name || 'User'}</p>
                        <p className="text-xs text-muted-foreground">{profile?.email}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/app/account')} className="cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      Account Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/app/help')} className="cursor-pointer">
                      <HelpCircle className="mr-2 h-4 w-4" />
                      Help
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={signOut} className="cursor-pointer text-destructive focus:text-destructive">
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>
            <main className="flex-1 p-4 md:p-6 overflow-auto">
              <Outlet />
            </main>
          </div>
        </div>
        <UpgradeModal
          open={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          country={orgCountry}
        />
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
