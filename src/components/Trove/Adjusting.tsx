import React, { useCallback, useEffect, useState, useRef } from 'react'
import { Button, Box, HStack } from '@chakra-ui/react'
import {
    LiquityStoreState,
    Decimal,
    Trove,
    LUSD_LIQUIDATION_RESERVE,
    Percent,
    Difference,
} from '@liquity/lib-base'
import { useLiquitySelector } from '../../hooks/useLiquitySelector'

import { useStableTroveChange } from '../../hooks/useStableTroveChange'
import { useMyTransactionState } from '../Transaction'
import { TroveAction } from './TroveAction'
import { useTroveView } from './context/TroveViewContext'
import { Icon } from '../Icon'
import { LoadingOverlay } from '../LoadingOverlay'
import { EditableRow, StaticRow } from './Editor'
import {
    ExpensiveTroveChangeWarning,
    GasEstimationState,
} from './ExpensiveTroveChangeWarning'
import { CardBase } from '../Layout/CardBase'
import {
    selectForTroveChangeValidation,
    validateTroveChange,
} from './validation/validateTroveChange'
import { CollateralRatio } from './CollateralRatio'
import { ActionDescription } from 'components/ActionDescription'
import { HeadingBase } from 'components/HeadingBase'

const selector = (state: LiquityStoreState) => {
    const { trove, fees, price, accountBalance } = state
    return {
        trove,
        fees,
        price,
        accountBalance,
        validationContext: selectForTroveChangeValidation(state),
    }
}

const TRANSACTION_ID = 'trove-adjustment'
const GAS_ROOM_ETH = Decimal.from(0.1)

const feeFrom = (
    original: Trove,
    edited: Trove,
    borrowingRate: Decimal
): Decimal => {
    const change = original.whatChanged(edited, borrowingRate)

    if (
        change &&
        change.type !== 'invalidCreation' &&
        change.params.borrowLUSD
    ) {
        return change.params.borrowLUSD.mul(borrowingRate)
    } else {
        return Decimal.ZERO
    }
}

const applyUnsavedCollateralChanges = (
    unsavedChanges: Difference,
    trove: Trove
) => {
    if (unsavedChanges.absoluteValue) {
        if (unsavedChanges.positive) {
            return trove.collateral.add(unsavedChanges.absoluteValue)
        }
        if (unsavedChanges.negative) {
            if (unsavedChanges.absoluteValue.lt(trove.collateral)) {
                return trove.collateral.sub(unsavedChanges.absoluteValue)
            }
        }
        return trove.collateral
    }
    return trove.collateral
}

const applyUnsavedNetDebtChanges = (
    unsavedChanges: Difference,
    trove: Trove
) => {
    if (unsavedChanges.absoluteValue) {
        if (unsavedChanges.positive) {
            return trove.netDebt.add(unsavedChanges.absoluteValue)
        }
        if (unsavedChanges.negative) {
            if (unsavedChanges.absoluteValue.lt(trove.netDebt)) {
                return trove.netDebt.sub(unsavedChanges.absoluteValue)
            }
        }
        return trove.netDebt
    }
    return trove.netDebt
}

export const Adjusting: React.FC = () => {
    const { dispatchEvent } = useTroveView()
    const { trove, fees, price, accountBalance, validationContext } =
        useLiquitySelector(selector)
    const editingState = useState<string>()
    const previousTrove = useRef<Trove>(trove)
    const [collateral, setCollateral] = useState<Decimal>(trove.collateral)
    const [netDebt, setNetDebt] = useState<Decimal>(trove.netDebt)

    const transactionState = useMyTransactionState(TRANSACTION_ID)
    const borrowingRate = fees.borrowingRate()

    useEffect(() => {
        if (transactionState.type === 'confirmedOneShot') {
            dispatchEvent('TROVE_ADJUSTED')
        }
    }, [transactionState.type, dispatchEvent])

    useEffect(() => {
        if (!previousTrove.current.collateral.eq(trove.collateral)) {
            const unsavedChanges = Difference.between(
                collateral,
                previousTrove.current.collateral
            )
            const nextCollateral = applyUnsavedCollateralChanges(
                unsavedChanges,
                trove
            )
            setCollateral(nextCollateral)
        }
        if (!previousTrove.current.netDebt.eq(trove.netDebt)) {
            const unsavedChanges = Difference.between(
                netDebt,
                previousTrove.current.netDebt
            )
            const nextNetDebt = applyUnsavedNetDebtChanges(
                unsavedChanges,
                trove
            )
            setNetDebt(nextNetDebt)
        }
        previousTrove.current = trove
    }, [trove, collateral, netDebt])

    const handleCancelPressed = useCallback(() => {
        dispatchEvent('CANCEL_ADJUST_TROVE_PRESSED')
    }, [dispatchEvent])

    const reset = useCallback(() => {
        setCollateral(trove.collateral)
        setNetDebt(trove.netDebt)
    }, [trove.collateral, trove.netDebt])

    const isDirty =
        !collateral.eq(trove.collateral) || !netDebt.eq(trove.netDebt)
    const isDebtIncrease = netDebt.gt(trove.netDebt)
    const debtIncreaseAmount = isDebtIncrease
        ? netDebt.sub(trove.netDebt)
        : Decimal.ZERO

    const fee = isDebtIncrease
        ? feeFrom(
              trove,
              new Trove(trove.collateral, trove.debt.add(debtIncreaseAmount)),
              borrowingRate
          )
        : Decimal.ZERO
    const totalDebt = netDebt.add(LUSD_LIQUIDATION_RESERVE).add(fee)
    const maxBorrowingRate = borrowingRate.add(0.005)
    const updatedTrove = isDirty ? new Trove(collateral, totalDebt) : trove
    const feePct = new Percent(borrowingRate)
    const availableEth = accountBalance.gt(GAS_ROOM_ETH)
        ? accountBalance.sub(GAS_ROOM_ETH)
        : Decimal.ZERO
    const maxCollateral = trove.collateral.add(availableEth)
    const collateralMaxedOut = collateral.eq(maxCollateral)
    const collateralRatio =
        !collateral.isZero && !netDebt.isZero
            ? updatedTrove.collateralRatio(price)
            : undefined
    const collateralRatioChange = Difference.between(
        collateralRatio,
        trove.collateralRatio(price)
    )

    const [troveChange, description] = validateTroveChange(
        trove,
        updatedTrove,
        borrowingRate,
        validationContext
    )

    const stableTroveChange = useStableTroveChange(troveChange)
    const [gasEstimationState, setGasEstimationState] =
        useState<GasEstimationState>({ type: 'idle' })

    const isTransactionPending =
        transactionState.type === 'waitingForApproval' ||
        transactionState.type === 'waitingForConfirmation'

    if (trove.status !== 'open') {
        return null
    }

    return (
        <CardBase>
            <HeadingBase>
                Trove
                {isDirty && !isTransactionPending && (
                    <Button
                        variant='titleIcon'
                        sx={{ ':enabled:hover': { color: 'danger' } }}
                        onClick={reset}
                    >
                        <Icon name='history' size='lg' />
                    </Button>
                )}
            </HeadingBase>

            <Box
                sx={{
                    '& > *:nth-of-type(2)': {
                        maxHeight: '69px',
                    },
                }}
            >
                <EditableRow
                    label='Collateral'
                    inputID='trove-collateral'
                    amount={collateral.prettify(4)}
                    maxAmount={maxCollateral.toString()}
                    maxedOut={collateralMaxedOut}
                    editingState={editingState}
                    unit='ETH'
                    editedAmount={collateral.toString(4)}
                    setEditedAmount={(amount: string) =>
                        setCollateral(Decimal.from(amount))
                    }
                />

                <EditableRow
                    label='Net debt'
                    inputID='trove-net-debt-amount'
                    amount={netDebt.prettify()}
                    unit={'LUSD'}
                    editingState={editingState}
                    editedAmount={netDebt.toString(2)}
                    setEditedAmount={(amount: string) =>
                        setNetDebt(Decimal.from(amount))
                    }
                />

                <Box marginTop={4} marginBottom={6}>
                    <StaticRow
                        label='Liquidation Reserve'
                        inputID='trove-liquidation-reserve'
                        amount={`${LUSD_LIQUIDATION_RESERVE}`}
                        unit={'LUSD'}
                        tooltipText='An amount set aside to cover the liquidator’s gas costs if your Trove needs to be liquidated. The amount increases your debt and is refunded if you close your Trove by fully paying off its net debt.'
                    />

                    <StaticRow
                        label='Borrowing Fee'
                        inputID='trove-borrowing-fee'
                        amount={fee.prettify(2)}
                        pendingAmount={feePct.toString(2)}
                        unit={'LUSD'}
                        tooltipText='This amount is deducted from the borrowed amount as a one-time fee. There are no recurring fees for borrowing, which is thus interest-free.'
                    />

                    <StaticRow
                        label='Total debt'
                        inputID='trove-total-debt'
                        amount={totalDebt.prettify(2)}
                        unit={'LUSD'}
                        tooltipText={`The total amount of LUSD your Trove will hold. ${
                            isDirty && (
                                <>
                                    You will need to repay{' '}
                                    {totalDebt
                                        .sub(LUSD_LIQUIDATION_RESERVE)
                                        .prettify(2)}{' '}
                                    LUSD to reclaim your collateral (
                                    {LUSD_LIQUIDATION_RESERVE.toString()} LUSD
                                    Liquidation Reserve excluded).
                                </>
                            )
                        }`}
                    />

                    <CollateralRatio
                        value={collateralRatio}
                        change={collateralRatioChange}
                    />
                </Box>
                {description ?? (
                    <ActionDescription>
                        Adjust your Trove by modifying its collateral, debt, or
                        both.
                    </ActionDescription>
                )}

                <ExpensiveTroveChangeWarning
                    troveChange={stableTroveChange}
                    maxBorrowingRate={maxBorrowingRate}
                    borrowingFeeDecayToleranceMinutes={60}
                    gasEstimationState={gasEstimationState}
                    setGasEstimationState={setGasEstimationState}
                />

                <HStack>
                    <Button
                        m={0}
                        variant='darkGrey'
                        onClick={handleCancelPressed}
                    >
                        Cancel
                    </Button>

                    {stableTroveChange ? (
                        <TroveAction
                            transactionId={TRANSACTION_ID}
                            change={stableTroveChange}
                            maxBorrowingRate={maxBorrowingRate}
                            borrowingFeeDecayToleranceMinutes={60}
                        >
                            Confirm
                        </TroveAction>
                    ) : (
                        <Button variant='mainPurple' disabled>
                            Confirm
                        </Button>
                    )}
                </HStack>
            </Box>
            {isTransactionPending && <LoadingOverlay />}
        </CardBase>
    )
}
