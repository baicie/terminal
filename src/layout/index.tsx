import React from "react";
import { Outlet } from "react-router-dom";
import { BellIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import MenuTabs from "./tabs";

const DeftLayout: React.FC = () => {
  return (
    <div className="h-screen flex flex-col">
      <header
        className="h-[50px] flex items-center justify-between px-4"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-4">
          <MenuTabs />
        </div>
        <Button variant="ghost" size="icon">
          <BellIcon className="h-5 w-5" />
        </Button>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
};

export default DeftLayout;
