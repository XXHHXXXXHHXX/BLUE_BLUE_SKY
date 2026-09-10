'use client';

import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, message } from 'antd';
import { useDesignTopologyStore } from '../../stores/designTopologyStore';

interface RenameTopologyModalProps {
  open: boolean;
  onClose: () => void;
  topologyId: string;
  currentName: string;
  currentDescription?: string;
}

const RenameTopologyModal: React.FC<RenameTopologyModalProps> = ({
  open,
  onClose,
  topologyId,
  currentName,
  currentDescription,
}) => {
  const [form] = Form.useForm();
  const { renameTopology } = useDesignTopologyStore();
  const [loading, setLoading] = useState(false);

  // 打开时设置初始值
  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        name: currentName,
        description: currentDescription,
      });
    }
  }, [open, currentName, currentDescription, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const success = await renameTopology(
        topologyId,
        values.name,
        values.description
      );

      if (success) {
        message.success('拓扑信息已更新');
        onClose();
      } else {
        message.error('更新失败');
      }
    } catch {
      // 表单验证失败
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title="编辑拓扑信息"
      open={open}
      onOk={handleSubmit}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText="保存"
      cancelText="取消"
    >
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 16 }}
      >
        <Form.Item
          name="name"
          label="拓扑名称"
          rules={[
            { required: true, message: '请输入拓扑名称' },
            { max: 50, message: '名称不能超过50个字符' },
          ]}
        >
          <Input placeholder="例如：服务器A" />
        </Form.Item>

        <Form.Item
          name="description"
          label="描述（可选）"
          rules={[{ max: 200, message: '描述不能超过200个字符' }]}
        >
          <Input.TextArea
            rows={2}
            placeholder="拓扑描述信息..."
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default RenameTopologyModal;
