import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Table,
  Badge,
  Button,
  Modal,
  TextInput,
  Select,
  Stack,
  Group,
  Title,
  Text,
} from '@mantine/core';
import { useForm, zodResolver } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { z } from 'zod';
import { WbsElementDetail, WbsElementType } from '../../types';
import { IconPlus } from '@tabler/icons-react';

interface WbsListViewProps {
  planVersionId: number | null;
}

const addElementSchema = z.object({
  title: z.string().min(1, { message: 'Title is required' }),
  elementType: z.enum(['Project', 'WorkPackage', 'Activity']),
});

export function WbsListView({ planVersionId }: WbsListViewProps) {
  const [elements, setElements] = useState<WbsElementDetail[]>([]);
  const [opened, { open, close }] = useDisclosure(false);

  const fetchElements = async () => {
    if (!planVersionId) return;
    try {
      const result = await invoke<WbsElementDetail[]>('list_wbs_elements', {
        planVersionId,
      });
      setElements(result);
    } catch (error) {
      console.error('Failed to fetch WBS elements:', error);
    }
  };

  useEffect(() => {
    if (planVersionId) {
      fetchElements();
    } else {
      setElements([]);
    }
  }, [planVersionId]);

  const form = useForm({
    initialValues: {
      title: '',
      elementType: 'Activity' as WbsElementType,
    },
    validate: zodResolver(addElementSchema),
  });

  const handleAddElement = async (values: typeof form.values) => {
    if (!planVersionId) return;
    try {
      await invoke('add_wbs_element', {
        payload: {
          planVersionId,
          title: values.title,
          elementType: values.elementType,
          // Other fields are optional for now
          parentElementId: null,
          milestoneId: null,
          description: null,
          estimatedPv: null,
          tags: null,
        },
      });
      close();
      form.reset();
      fetchElements(); // Refresh the list
    } catch (error) {
      console.error('Failed to add WBS element:', error);
    }
  };

  const getBadgeColor = (type: WbsElementType) => {
    switch (type) {
      case 'Project':
        return 'blue';
      case 'WorkPackage':
        return 'cyan';
      case 'Activity':
        return 'teal';
      default:
        return 'gray';
    }
  };

  const rows = elements.map((element) => (
    <Table.Tr key={element.id}>
      <Table.Td>{element.title}</Table.Td>
      <Table.Td>
        <Badge color={getBadgeColor(element.elementType)}>{element.elementType}</Badge>
      </Table.Td>
      <Table.Td>{element.estimatedPv ?? 'N/A'}</Table.Td>
    </Table.Tr>
  ));

  if (!planVersionId) {
    return (
      <Text c="dimmed" style={{ textAlign: 'center', paddingTop: '2rem' }}>
        Please select a project to see its WBS.
      </Text>
    );
  }

  return (
    <>
      <Modal opened={opened} onClose={close} title="Add New WBS Element">
        <form onSubmit={form.onSubmit(handleAddElement)}>
          <Stack>
            <TextInput
              withAsterisk
              label="Title"
              placeholder="e.g., Design UI"
              {...form.getInputProps('title')}
            />
            <Select
              withAsterisk
              label="Element Type"
              data={['Project', 'WorkPackage', 'Activity']}
              {...form.getInputProps('elementType')}
            />
            <Group justify="flex-end" mt="md">
              <Button type="submit">Add Element</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Group justify="space-between" mb="md">
        <Title order={2}>WBS & Estimates</Title>
        <Button onClick={open} leftSection={<IconPlus size={14} />}>
          Add Element
        </Button>
      </Group>

      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>WBS Title</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Estimated PV</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>
    </>
  );
}
