import {
  UserOutlined,
  VideoCameraOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { Layout, Menu, theme } from "antd";
import { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";

const { Sider, Content } = Layout;

const VaultsLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();

  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  return (
    <Layout>
      <Sider
        breakpoint="lg"
        collapsedWidth={50}
        trigger={null}
        collapsible
        collapsed={collapsed}
        onBreakpoint={(broken) => {
          setCollapsed(broken);
        }}
      >
        <Menu
          theme="dark"
          mode="inline"
          defaultSelectedKeys={["1"]}
          items={[
            {
              key: "1",
              icon: <UserOutlined />,
              label: "nav 1",
              onClick: () => navigate("/"),
            },
            {
              key: "2",
              icon: <VideoCameraOutlined />,
              label: "nav 2",
              onClick: () => navigate("/demo"),
            },
            {
              key: "3",
              icon: <UploadOutlined />,
              label: "nav 3",
            },
          ]}
        />
      </Sider>

      <Content
        style={{
          margin: "24px 16px",
          padding: 24,
          minHeight: 280,
          background: colorBgContainer,
          borderRadius: borderRadiusLG,
        }}
      >
        <Outlet />
      </Content>
    </Layout>
  );
};

export default VaultsLayout;
