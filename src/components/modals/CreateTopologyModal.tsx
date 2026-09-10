'use client';

import React, { useState } from 'react';
import { Modal, Form, Input, Radio, Space, message } from 'antd';
import { useDesignTopologyStore } from '../../stores/designTopologyStore';

interface CreateTopologyModalProps {
  open: boolean;
  onClose: () => void;
}

const CreateTopologyModal: React.FC<CreateTopologyModalProps> = ({
  open,
  onClose,
}) => {
  const [form] = Form.useForm();
  const { createTopology } = useDesignTopologyStore();
  const [loading, setLoading] = useState(false);
  const [createType, setCreateType] = useState<'blank' | 'copy'>('blank');

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const success = await createTopology(
        values.name,
        values.description,
        createType === 'copy'
      );

      if (success) {
        message.success('拓扑创建成功');
        form.resetFields();
        onClose();
      } else {
        message.error('拓扑创建失败');
      }
    } catch {
      // 表单验证失败
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setCreateType('blank');
    onClose();
  };

  return (
    <Modal
      title="新建拓扑"
      open={open}
      onOk={handleSubmit}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText="创建"
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

        <Form.Item label="创建方式">
          <Radio.Group
            value={createType}
            onChange={(e) => setCreateType(e.target.value)}
          >
            <Space direction="vertical">
              <Radio value="blank">从空白拓扑创建</Radio>
              <Radio value="copy">复制当前拓扑</Radio>
            </Space>
          </Radio.Group>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateTopologyModal;
