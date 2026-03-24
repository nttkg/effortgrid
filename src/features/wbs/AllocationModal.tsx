import { useEffect, useState, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Modal,
  Table,
  Button,
  Stack,
  Group,
  NumberInput,
  Text,
  Alert,
  ActionIcon,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconAlertCircle, IconTrash, IconPlus } from '@tabler/icons-react';
import { WbsElementDetail, PvAllocation } from '../../types';
import dayjs from 'dayjs';

interface AllocationModalProps {
  opened: boolean;
  onClose: () => void;
  element: WbsElementDetail | null;
  planVersionId: number | null;
}

// Helper to format date for backend
const formatDate = (date: Date): string => dayjs(date).format('YYYY-MM-DD');

export function AllocationModal({ opened, onClose, element, planVersionId }: AllocationModalProps) {
  const [allocations, setAllocations] = useState<PvAllocation[]>([]);

  const fetchAllocations = async () => {
    if (!element || !planVersionId) return;
    try {
      const result = await invoke<PvAllocation[]>('list_pv_allocations_for_wbs_element', {
        payload: {
          wbsElementId: element.wbsElementId,
          planVersionId,
        },
      });
      setAllocations(result);
    } catch (error) {
      console.error('Failed to fetch allocations:', error);
    }
  };

  useEffect(() => {
    if (opened) {
      fetchAllocations();
    }
  }, [opened, element]);

  const form = useForm({
    initialValues: {
      dateRange: [null, null] as [Date | null, Date | null],
      plannedValue: 0,
    },
    validate: {
      dateRange: (value) => (value[0] === null || value[1] === null ? 'Date range is required' : null),
      plannedValue: (value) => (value <= 0 ? 'PV must be greater than 0' : null),
    },
  });

  const handleAddAllocation = async (values: typeof form.values) => {
    if (!element || !planVersionId || !values.dateRange[0] || !values.dateRange[1]) return;
    try {
      await invoke('add_pv_allocation', {
        payload: {
          planVersionId,
          wbsElementId: element.wbsElementId,
          userId: null,
          startDate: formatDate(values.dateRange[0]),
          endDate: formatDate(values.dateRange[1]),
          plannedValue: values.plannedValue,
        },
      });
      form.reset();
      fetchAllocations();
    } catch (error) {
      console.error('Failed to add allocation:', error);
    }
  };

  const handleDeleteAllocation = async (id: number) => {
    try {
      await invoke('delete_pv_allocation', { id });
      fetchAllocations();
    } catch (error) {
      console.error('Failed to delete allocation:', error);
    }
  };

  const totalAllocated = useMemo(() => {
    return allocations.reduce((sum, alloc) => sum + alloc.plannedValue, 0);
  }, [allocations]);

  const estimatedPv = element?.estimatedPv ?? 0;
  const isOverAllocated = totalAllocated > estimatedPv;

  const rows = allocations.map((alloc) => (
    <Table.Tr key={alloc.id}>
      <Table.Td>{alloc.startDate}</Table.Td>
      <Table.Td>{alloc.endDate}</Table.Td>
      <Table.Td>{alloc.plannedValue}</Table.Td>
      <Table.Td>
        <ActionIcon color="red" onClick={() => handleDeleteAllocation(alloc.id)}>
          <IconTrash size={16} />
        </ActionIcon>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Modal opened={opened} onClose={onClose} title={`Allocate PV for "${element?.title}"`} size="lg">
      <Stack>
        <Group justify="space-around" mb="md">
          <Text>Total Estimated PV: <Text span fw={700}>{estimatedPv}</Text></Text>
          <Text>Total Allocated PV:
            <Text span fw={700} c={isOverAllocated ? 'red' : 'green'}> {totalAllocated} </Text>
          </Text>
        </Group>

        {isOverAllocated && (
          <Alert icon={<IconAlertCircle size="1rem" />} title="Over-allocated!" color="red" variant="light">
            The sum of allocated PV exceeds the total estimated PV for this activity.
          </Alert>
        )}

        <form onSubmit={form.onSubmit(handleAddAllocation)}>
          <Group align="flex-end" grow>
            <DatePickerInput type="range" label="Date Range" placeholder="Select dates" {...form.getInputProps('dateRange')} />
            <NumberInput label="Planned Value" placeholder="Enter PV" min={0} {...form.getInputProps('plannedValue')} />
            <Button type="submit" leftSection={<IconPlus size={14} />}>Add</Button>
          </Group>
        </form>

        <Table mt="md" withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Start Date</Table.Th>
              <Table.Th>End Date</Table.Th>
              <Table.Th>Planned Value</Table.Th>
              <Table.Th>Action</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>{rows.length > 0 ? rows : <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center">No allocations yet.</Text></Table.Td></Table.Tr>}</Table.Tbody>
        </Table>
      </Stack>
    </Modal>
  );
}
