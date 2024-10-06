import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Flex, Input, Menu, MenuProps, Modal, Tag } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

interface SelectDialogProps {
  open: boolean;
  onClose?: () => void;
}

const SelectDialog = (props: SelectDialogProps) => {
  const app = useInjectable(AppStore);
  const [label, setLabel] = useState("");
  const warpClick = (fn: Function) => {
    return () => {
      fn();
      props.onClose?.();
    };
  };
  const items: MenuProps["items"] = [
    {
      key: "quick",
      label: "quick connect",
      type: "group",
      children: [
        {
          key: "local",
          label: "local terminal",
          onClick: warpClick(() => {
            app.addTab({
              label: label || "local terminal",
              type: "local",
            });
          }),
        },
        {
          key: "2",
          label: "nothing",
        },
      ],
    },
  ];
  return (
    <Modal open={props.open}>
      <Flex vertical align="center">
        <Input
          value={label}
          onInput={(e) => {
            setLabel(e.currentTarget.value);
          }}
          prefix={
            <Flex>
              <SearchOutlined />

              <Tag>title</Tag>
            </Flex>
          }
        ></Input>

        <Menu style={{ width: "100%" }} items={items}></Menu>
      </Flex>
    </Modal>
  );
};

const MenuTabs: React.FC = () => {
  const app = useInjectable(AppStore);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Flex gap="small" align="center" justify="start">
        <Button
          type="primary"
          onClick={() => {
            navigate("/vaults");
          }}
        >
          vaults
        </Button>

        <Button
          type="primary"
          onClick={() => {
            navigate("/sftp");
          }}
        >
          sftp
        </Button>

        {app.tabs.map((tab) => {
          console.log(tab);

          return (
            <Button
              key={tab.key}
              type="primary"
              onClick={() => {
                navigate("/terminal");
              }}
            >
              {tab.label}
            </Button>
          );
        })}

        <Button
          onClick={() => {
            setOpen(true);
          }}
          type="text"
          icon={<PlusOutlined />}
        ></Button>
      </Flex>

      <SelectDialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      ></SelectDialog>
    </>
  );
};

export default MenuTabs;
