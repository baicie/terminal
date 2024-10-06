import { Button, Flex } from "antd";
import { useNavigate } from "react-router-dom";

const MenuTabs: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Flex gap="small" align="center" justify="start">
      <Button
        onClick={() => {
          navigate("/vaults");
        }}
      >
        vaults
      </Button>
      <Button
        onClick={() => {
          navigate("/sftp");
        }}
      >
        sftp
      </Button>
      <Button>Tab 3</Button>
    </Flex>
  );
};

export default MenuTabs;
