import { useEffect, useState } from 'react';
import { Table, Group, Button, Modal, TextInput, Stack, Title, ActionIcon, Tooltip, Text } from '@mantine/core';
import { useForm, zodResolver } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { z } from 'zod';
import { DatePickerInput } from '@mantine/dates';
import { IconPencil, IconTrash, IconPlus } from '@tabler/icons-react';
import { useMilestones, MilestonePayload } from '../../hooks/useMilestones';
import { PlanMilestone } from '../../types';

interface MilestoneViewProps {
    planVersionId: number | null;
    isReadOnly: boolean;
    portfolioId: number | null;
}

const milestoneSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    targetDate: z.date().nullable(),
});

export function MilestoneView({ planVersionId, isReadOnly, portfolioId }: MilestoneViewProps) {
    const { milestones, fetchMilestones, addMilestone, updateMilestone, deleteMilestone } = useMilestones(planVersionId, portfolioId);
    const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
    const [activeMilestone, setActiveMilestone] = useState<PlanMilestone | null>(null);

    useEffect(() => {
        if (planVersionId) {
            fetchMilestones();
        }
    }, [planVersionId, fetchMilestones]);

    const form = useForm({
        initialValues: { name: '', targetDate: null as Date | null },
        validate: zodResolver(milestoneSchema as any),
    });

    const handleOpenModal = (milestone: PlanMilestone | null) => {
        setActiveMilestone(milestone);
        form.reset();
        form.setValues({
            name: milestone?.name || '',
            targetDate: milestone?.targetDate ? new Date(milestone.targetDate) : null,
        });
        openModal();
    };

    const handleSubmit = async (values: typeof form.values) => {
        const payload: MilestonePayload = {
            name: values.name,
            targetDate: values.targetDate ? values.targetDate.toISOString().split('T')[0] : '',
        };
        if (activeMilestone) {
            await updateMilestone(activeMilestone.id, payload);
        } else {
            await addMilestone(payload);
        }
        closeModal();
    };
    
    const handleDelete = (milestone: PlanMilestone) => {
        // Here a confirmation modal would be good
        deleteMilestone(milestone.id);
    };

    const rows = milestones.map((m) => (
        <Table.Tr key={m.id}>
            <Table.Td>{m.name}</Table.Td>
            <Table.Td>{m.targetDate}</Table.Td>
            <Table.Td>
                {!isReadOnly && (
                    <Group gap="xs" justify="flex-end">
                        <Tooltip label="Edit milestone"><ActionIcon variant="subtle" onClick={() => handleOpenModal(m)}><IconPencil size={16} /></ActionIcon></Tooltip>
                        <Tooltip label="Delete milestone"><ActionIcon variant="subtle" color="red" onClick={() => handleDelete(m)}><IconTrash size={16} /></ActionIcon></Tooltip>
                    </Group>
                )}
            </Table.Td>
        </Table.Tr>
    ));

    if (!planVersionId) return <Text c="dimmed" ta="center" pt="xl">Please select a project to manage milestones.</Text>;

    return (
        <Stack>
            <Group justify="space-between">
                <Title order={2}>Milestones</Title>
                {!isReadOnly && <Button onClick={() => handleOpenModal(null)} leftSection={<IconPlus size={14} />}>Add Milestone</Button>}
            </Group>
            
            <Modal opened={modalOpened} onClose={closeModal} title={activeMilestone ? 'Edit Milestone' : 'Add Milestone'}>
                <form onSubmit={form.onSubmit(handleSubmit)}>
                    <Stack>
                        <TextInput withAsterisk label="Name" {...form.getInputProps('name')} />
                        <DatePickerInput label="Target Date" {...form.getInputProps('targetDate')} />
                        <Group justify="flex-end" mt="md"><Button type="submit">Save</Button></Group>
                    </Stack>
                </form>
            </Modal>

            <Table>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>Name</Table.Th>
                        <Table.Th>Target Date</Table.Th>
                        <Table.Th />
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>{rows}</Table.Tbody>
            </Table>
        </Stack>
    );
}
