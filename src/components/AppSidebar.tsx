import {
  LayoutDashboard,
  PlusCircle,
  FileText,
  CheckSquare,
  List,
  Users,
  LogOut,
  Settings,
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useAuth } from '@/contexts/AuthContext';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { User } from 'lucide-react';

export function AppSidebar() {
  const { profile, hasRole, hasAnyRole, isManager, signOut, organization } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  const mainItems = [
    { title: 'Dashboard', url: '/app', icon: LayoutDashboard, show: true },
    { title: 'Submit Expense', url: '/app/submit', icon: PlusCircle, show: true },
    { title: 'My Expenses', url: '/app/expenses', icon: FileText, show: true },
  ];

  // Approvals visible to anyone who is a manager-of-someone, or admin
  const managerItems = [
    { title: 'Approvals', url: '/app/approvals', icon: CheckSquare, show: isManager || hasRole('admin') },
  ];

  const adminItems = [
    { title: 'All Expenses', url: '/app/all-expenses', icon: List, show: hasAnyRole(['finance', 'admin']) },
    { title: 'User Management', url: '/app/users', icon: Users, show: hasRole('admin') },
    { title: 'Org Settings', url: '/app/settings', icon: Settings, show: hasRole('admin') },
  ];

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarContent className="bg-sidebar">
        <SidebarGroup>
          <SidebarGroupLabel className="px-4 py-3">
            <div className="flex items-center gap-3">
              <img
                src="/zeptra-logo.png"
                alt="Zeptra Logo"
                className="w-8 h-8 shrink-0 object-contain"
              />
              {!collapsed && (
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-lg text-sidebar-foreground leading-tight">Zeptra</span>
                  {organization && (
                    <span className="text-[10px] text-sidebar-foreground/50 truncate">{organization.name}</span>
                  )}
                </div>
              )}
            </div>
          </SidebarGroupLabel>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/60">Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.filter(i => i.show).map(item => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} end className="text-sidebar-foreground hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {managerItems.some(i => i.show) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/60">Management</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {managerItems.filter(i => i.show).map(item => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink to={item.url} end className="text-sidebar-foreground hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {adminItems.some(i => i.show) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/60">Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.filter(i => i.show).map(item => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink to={item.url} end className="text-sidebar-foreground hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="bg-sidebar border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
            <User className="w-4 h-4 text-sidebar-accent-foreground" />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{profile?.name || 'User'}</p>
              <p className="text-xs text-sidebar-foreground/60 truncate">{profile?.email}</p>
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={signOut} className="shrink-0 text-sidebar-foreground hover:bg-sidebar-accent">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
