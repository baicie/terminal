import { BellOutlined } from "@ant-design/icons";
import { Flex, Layout } from "antd";
import React from "react";
import { Outlet } from "react-router-dom";
import MenuTabs from "./tabs";

const { Header, Content } = Layout;

const DeftLayout: React.FC = () => {
  // const items: MenuProps["items"] = [
  //   {
  //     key: "en",
  //     label: "English",
  //     onClick: () => i18n.changeLanguage("en"),
  //   },
  //   {
  //     key: "cn",
  //     label: "中文",
  //     onClick: () => i18n.changeLanguage("cn"),
  //   },
  //   {
  //     key: "fr",
  //     label: "Français",
  //     onClick: () => i18n.changeLanguage("fr"),
  //   },
  // ];

  return (
    <Layout>
      <Header
        data-tauri-drag-region
        style={{ height: 50, padding: "0 12px 0 72px" }}
      >
        <Flex
          justify="space-between"
          style={{ width: "100%", height: "50px" }}
          align="center"
        >
          <MenuTabs />

          <BellOutlined />
        </Flex>
      </Header>
      <Content>
        <Outlet />
      </Content>
    </Layout>
  );
};

export default DeftLayout;

{
  /* <Header
            style={{ padding: "0 24px 0 0", background: colorBgContainer }}
          >
            <Flex justify="space-between" align="center">
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                style={{
                  fontSize: "16px",
                  width: 64,
                  height: 64,
                }}
              />

              <Dropdown menu={{ items }}>
                <div onClick={(e) => e.preventDefault()}>
                  {t("layout.language")} <DownOutlined />
                </div>
              </Dropdown>
            </Flex>
          </Header> */
}
