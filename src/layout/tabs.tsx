import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";

interface SelectDialogProps {
  open: boolean;
  onClose?: () => void;
}

const SelectDialog = (props: SelectDialogProps) => {
  const app = useInjectable(AppStore);
  const [label, setLabel] = useState("");

  return (
    <div className="p-4">
      <div className="flex items-center gap-2">
        <Input
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
          }}
          placeholder="title"
        />
        <Button
          onClick={() => {
            app.addTab({
              label: label || "local terminal",
              type: "local",
            });
            props.onClose?.();
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
};

const MenuTabs: React.FC = () => {
  const app = useInjectable(AppStore);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button onClick={() => navigate("/vaults")}>vaults</Button>
        <Button onClick={() => navigate("/sftp")}>sftp</Button>

        {app.tabs.map((tab) => (
          <Button
            key={tab.key}
            onClick={() => navigate("/terminal")}
          >
            {tab.label}
          </Button>
        ))}

        <Button variant="outline" size="icon" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <SelectDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
};

export default MenuTabs;
