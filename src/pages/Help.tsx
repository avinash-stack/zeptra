import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { HelpCircle, Mail, FileText, ExternalLink } from 'lucide-react';

const Help: React.FC = () => {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-info bg-clip-text text-transparent">
          Help & Support
        </h1>
        <p className="text-muted-foreground mt-1">Find answers and get assistance</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-info flex items-center justify-center">
              <FileText className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <CardTitle>Documentation</CardTitle>
              <CardDescription>Comprehensive guides and tutorials</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted/50 p-6 text-center space-y-2">
            <HelpCircle className="w-10 h-10 mx-auto text-muted-foreground" />
            <h3 className="font-semibold text-lg">Documentation Coming Soon</h3>
            <p className="text-muted-foreground text-sm">
              We're working on comprehensive help documentation to assist you with all features of Zeptra.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Contact Support
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <Mail className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="font-medium">support@zeptra.app</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Our support team typically responds within 24 hours during business days.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Help;
