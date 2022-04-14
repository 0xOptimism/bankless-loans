import { Flex, Text } from '@chakra-ui/react'
import {
    Decimal,
    LUSD_MINIMUM_DEBT,
    LUSD_MINIMUM_NET_DEBT,
    Trove,
    TroveAdjustmentParams,
    TroveChange,
    Percent,
    MINIMUM_COLLATERAL_RATIO,
    CRITICAL_COLLATERAL_RATIO,
    LiquityStoreState,
    TroveClosureParams,
    TroveCreationParams,
} from '@liquity/lib-base'

import { ActionDescription, Amount } from '../../ActionDescription'
import { ErrorDescription } from '../../ErrorDescription'

const mcrPercent = new Percent(MINIMUM_COLLATERAL_RATIO).toString(0)
const ccrPercent = new Percent(CRITICAL_COLLATERAL_RATIO).toString(0)

type TroveAdjustmentDescriptionParams = {
    params: TroveAdjustmentParams<Decimal>
}

const TroveChangeDescription: React.FC<TroveAdjustmentDescriptionParams> = ({
    params,
}) => (
    <ActionDescription>
        {params.depositCollateral && params.borrowLUSD ? (
            <>
                You will deposit{' '}
                <Amount>{params.depositCollateral.prettify()} ETH</Amount> and
                receive{' '}
                <Amount>
                    {params.borrowLUSD.prettify()} {'LUSD'}
                </Amount>
            </>
        ) : params.repayLUSD && params.withdrawCollateral ? (
            <>
                You will pay{' '}
                <Amount>
                    {params.repayLUSD.prettify()} {'LUSD'}
                </Amount>{' '}
                and receive{' '}
                <Amount>{params.withdrawCollateral.prettify()} ETH</Amount>
            </>
        ) : params.depositCollateral && params.repayLUSD ? (
            <>
                You will deposit{' '}
                <Amount>{params.depositCollateral.prettify()} ETH</Amount> and
                pay{' '}
                <Amount>
                    {params.repayLUSD.prettify()} {'LUSD'}
                </Amount>
            </>
        ) : params.borrowLUSD && params.withdrawCollateral ? (
            <>
                You will receive{' '}
                <Amount>{params.withdrawCollateral.prettify()} ETH</Amount> and{' '}
                <Amount>
                    {params.borrowLUSD.prettify()} {'LUSD'}
                </Amount>
            </>
        ) : params.depositCollateral ? (
            <>
                You will deposit{' '}
                <Amount>{params.depositCollateral.prettify()} ETH</Amount>
            </>
        ) : params.withdrawCollateral ? (
            <>
                You will receive{' '}
                <Amount>{params.withdrawCollateral.prettify()} ETH</Amount>
            </>
        ) : params.borrowLUSD ? (
            <>
                You will receive{' '}
                <Amount>
                    {params.borrowLUSD.prettify()} {'LUSD'}
                </Amount>
            </>
        ) : (
            <>
                You will pay{' '}
                <Amount>
                    {params.repayLUSD.prettify()} {'LUSD'}
                </Amount>
            </>
        )}
    </ActionDescription>
)

export const selectForTroveChangeValidation = ({
    price,
    total,
    accountBalance,
    lusdBalance,
    numberOfTroves,
}: LiquityStoreState) => ({
    price,
    total,
    accountBalance,
    lusdBalance,
    numberOfTroves,
})

type TroveChangeValidationSelectedState = ReturnType<
    typeof selectForTroveChangeValidation
>

interface TroveChangeValidationContext
    extends TroveChangeValidationSelectedState {
    originalTrove: Trove
    resultingTrove: Trove
    recoveryMode: boolean
    wouldTriggerRecoveryMode: boolean
}

export const validateTroveChange = (
    originalTrove: Trove,
    adjustedTrove: Trove,
    borrowingRate: Decimal,
    selectedState: TroveChangeValidationSelectedState
): [
    validChange:
        | Exclude<TroveChange<Decimal>, { type: 'invalidCreation' }>
        | undefined,
    description: JSX.Element | undefined
] => {
    const { total, price } = selectedState
    const change = originalTrove.whatChanged(adjustedTrove, borrowingRate)

    if (!change) {
        return [undefined, undefined]
    }

    // Reapply change to get the exact state the Trove will end up in (which could be slightly
    // different from `edited` due to imprecision).
    const resultingTrove = originalTrove.apply(change, borrowingRate)
    const recoveryMode = total.collateralRatioIsBelowCritical(price)
    const wouldTriggerRecoveryMode = total
        .subtract(originalTrove)
        .add(resultingTrove)
        .collateralRatioIsBelowCritical(price)

    const context: TroveChangeValidationContext = {
        ...selectedState,
        originalTrove,
        resultingTrove,
        recoveryMode,
        wouldTriggerRecoveryMode,
    }

    if (change.type === 'invalidCreation') {
        // Trying to create a Trove with negative net debt
        return [
            undefined,
            <ErrorDescription key='invalid-creation'>
                <Text ml='0.25rem'>
                    Total debt must be at least{' '}
                    <Amount>
                        {LUSD_MINIMUM_DEBT.toString()} {'LUSD'}
                    </Amount>
                </Text>
            </ErrorDescription>,
        ]
    }

    const errorDescription =
        change.type === 'creation'
            ? validateTroveCreation(change.params, context)
            : change.type === 'closure'
            ? validateTroveClosure(change.params, context)
            : validateTroveAdjustment(change.params, context)

    if (errorDescription) {
        return [undefined, errorDescription]
    }

    return [change, <TroveChangeDescription params={change.params} />]
}

const validateTroveCreation = (
    { depositCollateral, borrowLUSD }: TroveCreationParams<Decimal>,
    {
        resultingTrove,
        recoveryMode,
        wouldTriggerRecoveryMode,
        accountBalance,
        price,
    }: TroveChangeValidationContext
): JSX.Element | null => {
    if (borrowLUSD.lt(LUSD_MINIMUM_NET_DEBT)) {
        return (
            <ErrorDescription>
                <Text ml='0.25rem'>
                    You must borrow at least{' '}
                    <Amount>
                        {LUSD_MINIMUM_NET_DEBT.toString()} {'LUSD'}
                    </Amount>
                </Text>
            </ErrorDescription>
        )
    }

    if (recoveryMode) {
        if (!resultingTrove.isOpenableInRecoveryMode(price)) {
            return (
                <ErrorDescription>
                    You&apos;re not allowed to open a Trove with less than{' '}
                    <Amount>{ccrPercent}</Amount> Collateral Ratio during
                    recovery mode. Please increase your Trove&apos;s Collateral
                    Ratio.
                </ErrorDescription>
            )
        }
    } else {
        if (resultingTrove.collateralRatioIsBelowMinimum(price)) {
            return (
                <ErrorDescription>
                    <Text ml='0.25rem'>
                        Collateral ratio must be at least{' '}
                        <Amount>{mcrPercent}</Amount>
                    </Text>
                </ErrorDescription>
            )
        }

        if (wouldTriggerRecoveryMode) {
            return (
                <ErrorDescription>
                    You&apos;re not allowed to open a Trove that would cause the
                    Total Collateral Ratio to fall below{' '}
                    <Amount>{ccrPercent}</Amount>. Please increase your
                    Trove&apos;s Collateral Ratio.
                </ErrorDescription>
            )
        }
    }

    if (depositCollateral.gt(accountBalance)) {
        return (
            <ErrorDescription>
                <Text ml='0.25rem'>
                    The amount you&apos;re trying to deposit exceeds your
                    balance by{' '}
                    <Amount>
                        {depositCollateral.sub(accountBalance).prettify()} ETH
                    </Amount>
                </Text>
            </ErrorDescription>
        )
    }

    return null
}

const validateTroveAdjustment = (
    {
        depositCollateral,
        withdrawCollateral,
        borrowLUSD,
        repayLUSD,
    }: TroveAdjustmentParams<Decimal>,
    {
        originalTrove,
        resultingTrove,
        recoveryMode,
        wouldTriggerRecoveryMode,
        price,
        accountBalance,
        lusdBalance,
    }: TroveChangeValidationContext
): JSX.Element | null => {
    if (recoveryMode) {
        if (withdrawCollateral) {
            return (
                <ErrorDescription>
                    <Text ml='0.25rem'>
                        You&apos;re not allowed to withdraw collateral during
                        recovery mode.
                    </Text>
                </ErrorDescription>
            )
        }

        if (borrowLUSD) {
            if (resultingTrove.collateralRatioIsBelowCritical(price)) {
                return (
                    <ErrorDescription>
                        Your collateral ratio must be at least{' '}
                        <Amount>{ccrPercent}</Amount> to borrow during recovery
                        mode. Please improve your collateral ratio.
                    </ErrorDescription>
                )
            }

            if (
                resultingTrove
                    .collateralRatio(price)
                    .lt(originalTrove.collateralRatio(price))
            ) {
                return (
                    <ErrorDescription>
                        You&apos;re not allowed to decrease your collateral
                        ratio during recovery mode.
                    </ErrorDescription>
                )
            }
        }
    } else {
        if (resultingTrove.collateralRatioIsBelowMinimum(price)) {
            return (
                <ErrorDescription>
                    <Text ml='0.25rem'>
                        Collateral ratio must be at least{' '}
                        <Amount>{mcrPercent}</Amount>
                    </Text>
                </ErrorDescription>
            )
        }

        if (wouldTriggerRecoveryMode) {
            return (
                <ErrorDescription>
                    The adjustment you&apos;re trying to make would cause the
                    Total Collateral Ratio to fall below{' '}
                    <Amount>{ccrPercent}</Amount>. Please increase your
                    Trove&apos;s Collateral Ratio.
                </ErrorDescription>
            )
        }
    }

    if (repayLUSD) {
        if (resultingTrove.debt.lt(LUSD_MINIMUM_DEBT)) {
            return (
                <ErrorDescription>
                    <Text ml='0.25rem'>
                        Total debt must be at least{' '}
                        <Amount>
                            {LUSD_MINIMUM_DEBT.toString()} {'LUSD'}
                        </Amount>
                    </Text>
                </ErrorDescription>
            )
        }

        if (repayLUSD.gt(lusdBalance)) {
            return (
                <ErrorDescription>
                    <Text ml='0.25rem'>
                        The amount you&apos;re trying to repay exceeds your
                        balance by{' '}
                        <Amount>
                            {repayLUSD.sub(lusdBalance).prettify()} {'LUSD'}
                        </Amount>
                    </Text>
                </ErrorDescription>
            )
        }
    }

    if (depositCollateral?.gt(accountBalance)) {
        return (
            <ErrorDescription>
                <Text ml='0.25rem'>
                    The amount you&apos;re trying to deposit exceeds your
                    balance by{' '}
                    <Amount>
                        {depositCollateral.sub(accountBalance).prettify()} ETH
                    </Amount>
                </Text>
            </ErrorDescription>
        )
    }

    return null
}

const validateTroveClosure = (
    { repayLUSD }: TroveClosureParams<Decimal>,
    {
        recoveryMode,
        wouldTriggerRecoveryMode,
        numberOfTroves,
        lusdBalance,
    }: TroveChangeValidationContext
): JSX.Element | null => {
    if (numberOfTroves === 1) {
        return (
            <ErrorDescription>
                <Text ml='0.25rem'>
                    You&apos;re not allowed to close your Trove when there are
                    no other Troves in the system.
                </Text>
            </ErrorDescription>
        )
    }

    if (recoveryMode) {
        return (
            <ErrorDescription>
                <Text ml='0.25rem'>
                    You&apos;re not allowed to close your Trove during recovery
                    mode.
                </Text>
            </ErrorDescription>
        )
    }

    if (repayLUSD?.gt(lusdBalance)) {
        return (
            <ErrorDescription>
                <Text ml='0.25rem'>
                    You need{' '}
                    <Amount>
                        {repayLUSD.sub(lusdBalance).prettify()} {'LUSD'}
                    </Amount>{' '}
                    more to close your Trove.
                </Text>
            </ErrorDescription>
        )
    }

    if (wouldTriggerRecoveryMode) {
        return (
            <ErrorDescription>
                You&apos;re not allowed to close a Trove if it would cause the
                Total Collateralization Ratio to fall below{' '}
                <Amount>{ccrPercent}</Amount>. Please wait until the Total
                Collateral Ratio increases.
            </ErrorDescription>
        )
    }

    return null
}
